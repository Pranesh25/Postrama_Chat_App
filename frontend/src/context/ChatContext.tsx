import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { api, API } from '../api/client';

export type Message = {
  message_id: string;
  chat_id: string;
  sender_id: string;
  text?: string | null;
  image?: string | null;
  created_at: string;
  edited_at?: string | null;
  read_by: string[];
  client_id?: string | null;
  pending?: boolean;
  failed?: boolean;
};

export type ChatMember = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  online?: boolean;
};

export type Chat = {
  chat_id: string;
  is_group: boolean;
  name?: string | null;
  members: ChatMember[];
  created_by: string;
  last_message?: string | null;
  last_message_at?: string | null;
  last_sender_id?: string | null;
  unread: number;
};

type OutboxItem = { client_id: string; chat_id: string; text?: string; image?: string; created_at: string };

type ChatState = {
  chats: Chat[];
  messages: Record<string, Message[]>;
  typing: Record<string, Set<string>>;
  connected: boolean;
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  banner: { chat_id: string; title: string; body: string } | null;
  dismissBanner: () => void;
  refreshChats: () => Promise<void>;
  loadMessages: (chat_id: string) => Promise<void>;
  sendMessage: (chat_id: string, text?: string, image?: string) => Promise<void>;
  editMessage: (message_id: string, text: string) => Promise<void>;
  deleteMessage: (message_id: string) => Promise<void>;
  deleteChat: (chat_id: string) => Promise<void>;
  markRead: (chat_id: string) => Promise<void>;
  sendTyping: (chat_id: string, is_typing: boolean) => void;
  createChat: (member_ids: string[], is_group: boolean, name?: string) => Promise<Chat>;
};

const Ctx = createContext<ChatState>({} as ChatState);

const OUTBOX_KEY = 'bubble_outbox';

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user, token, setUser } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [typing, setTyping] = useState<Record<string, Set<string>>>({});
  const [connected, setConnected] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;
  const [banner, setBanner] = useState<{ chat_id: string; title: string; body: string } | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismissBanner = useCallback(() => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(null);
  }, []);
  const showBanner = useCallback((b: { chat_id: string; title: string; body: string }) => {
    setBanner(b);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }, []);

  // ---------- outbox helpers ----------
  const readOutbox = async (): Promise<OutboxItem[]> => {
    try {
      const raw = await AsyncStorage.getItem(OUTBOX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };
  const writeOutbox = async (items: OutboxItem[]) => {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  };

  const refreshChats = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api('/api/chats', token);
      setChats(list);
    } catch (e) { /* offline */ }
  }, [token]);

  const loadMessages = useCallback(async (chat_id: string) => {
    if (!token) return;
    try {
      const list = await api(`/api/chats/${chat_id}/messages`, token);
      setMessages((m) => ({ ...m, [chat_id]: list }));
    } catch {}
  }, [token]);

  const flushOutbox = useCallback(async () => {
    if (!token) return;
    const items = await readOutbox();
    const remaining: OutboxItem[] = [];
    for (const it of items) {
      try {
        await api('/api/messages', token, {
          method: 'POST',
          body: JSON.stringify({ chat_id: it.chat_id, text: it.text, image: it.image, client_id: it.client_id }),
        });
      } catch {
        remaining.push(it);
      }
    }
    await writeOutbox(remaining);
  }, [token]);

  const sendMessage = useCallback(async (chat_id: string, text?: string, image?: string) => {
    if (!user) return;
    const client_id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      message_id: client_id,
      chat_id, sender_id: user.user_id,
      text: text || null, image: image || null,
      created_at: new Date().toISOString(),
      read_by: [user.user_id],
      client_id, pending: true,
    };
    setMessages((m) => ({ ...m, [chat_id]: [...(m[chat_id] || []), optimistic] }));

    if (!token) return;
    try {
      const sent = await api('/api/messages', token, {
        method: 'POST',
        body: JSON.stringify({ chat_id, text, image, client_id }),
      });
      setMessages((m) => {
        const list = (m[chat_id] || []).map((x) => x.client_id === client_id ? { ...sent, pending: false } : x);
        return { ...m, [chat_id]: list };
      });
    } catch {
      // queue in outbox
      const items = await readOutbox();
      items.push({ client_id, chat_id, text, image, created_at: optimistic.created_at });
      await writeOutbox(items);
    }
  }, [token, user]);

  const markRead = useCallback(async (chat_id: string) => {
    if (!token) return;
    try { await api(`/api/chats/${chat_id}/read`, token, { method: 'POST' }); } catch {}
    setChats((cs) => cs.map((c) => c.chat_id === chat_id ? { ...c, unread: 0 } : c));
  }, [token]);

  const editMessage = useCallback(async (message_id: string, text: string) => {
    if (!token) return;
    const t = text.trim();
    if (!t) return;
    // optimistic
    setMessages((m) => {
      const out = { ...m };
      for (const cid of Object.keys(out)) {
        out[cid] = out[cid].map((msg) => msg.message_id === message_id ? { ...msg, text: t, edited_at: new Date().toISOString() } : msg);
      }
      return out;
    });
    try {
      await api(`/api/messages/${message_id}`, token, { method: 'PATCH', body: JSON.stringify({ text: t }) });
    } catch {}
  }, [token]);

  const deleteMessage = useCallback(async (message_id: string) => {
    if (!token) return;
    setMessages((m) => {
      const out = { ...m };
      for (const cid of Object.keys(out)) out[cid] = out[cid].filter((msg) => msg.message_id !== message_id);
      return out;
    });
    try { await api(`/api/messages/${message_id}`, token, { method: 'DELETE' }); } catch {}
  }, [token]);

  const deleteChat = useCallback(async (chat_id: string) => {
    if (!token) return;
    setChats((cs) => cs.filter((c) => c.chat_id !== chat_id));
    setMessages((m) => { const out = { ...m }; delete out[chat_id]; return out; });
    try { await api(`/api/chats/${chat_id}`, token, { method: 'DELETE' }); } catch {}
  }, [token]);

  const createChat = useCallback(async (member_ids: string[], is_group: boolean, name?: string): Promise<Chat> => {
    const c = await api('/api/chats', token, {
      method: 'POST',
      body: JSON.stringify({ member_ids, is_group, name }),
    });
    await refreshChats();
    return c;
  }, [token, refreshChats]);

  const sendTyping = useCallback((chat_id: string, is_typing: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'typing', chat_id, is_typing }));
    }
  }, []);

  // ---------- websocket ----------
  useEffect(() => {
    if (!token) return;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const wsUrl = `${API!.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        flushOutbox();
        refreshChats();
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'message') {
            const msg: Message = data.message;
            setMessages((m) => {
              const existing = m[msg.chat_id] || [];
              if (existing.some((x) => x.message_id === msg.message_id)) return m;
              const replaced = existing.map((x) => x.client_id && x.client_id === msg.client_id ? { ...msg, pending: false } : x);
              const found = replaced.some((x) => x.message_id === msg.message_id);
              return { ...m, [msg.chat_id]: found ? replaced : [...replaced, msg] };
            });
            refreshChats();
            // Banner if in different chat & not our own message
            if (user && msg.sender_id !== user.user_id && activeChatIdRef.current !== msg.chat_id) {
              const chatInfo = chatsRef.current.find((c) => c.chat_id === msg.chat_id);
              const senderInfo = chatInfo?.members.find((mm) => mm.user_id === msg.sender_id);
              const title = chatInfo?.is_group
                ? `${senderInfo?.name || 'Someone'} in ${chatInfo?.name || 'Group'}`
                : (senderInfo?.name || 'New message');
              const body = msg.text || (msg.image ? '📷 Photo' : '');
              showBanner({ chat_id: msg.chat_id, title, body: body.slice(0, 100) });
            }
          } else if (data.type === 'message_updated') {
            const msg: Message = data.message;
            setMessages((m) => {
              const list = (m[msg.chat_id] || []).map((x) => x.message_id === msg.message_id ? { ...msg } : x);
              return { ...m, [msg.chat_id]: list };
            });
            refreshChats();
          } else if (data.type === 'message_deleted') {
            const { chat_id, message_id } = data;
            setMessages((m) => ({ ...m, [chat_id]: (m[chat_id] || []).filter((x) => x.message_id !== message_id) }));
            refreshChats();
          } else if (data.type === 'chat_deleted') {
            setChats((cs) => cs.filter((c) => c.chat_id !== data.chat_id));
            setMessages((m) => { const out = { ...m }; delete out[data.chat_id]; return out; });
          } else if (data.type === 'profile_updated') {
            const u = data.user;
            setChats((cs) => cs.map((c) => ({
              ...c,
              members: c.members.map((m) => m.user_id === u.user_id ? { ...m, name: u.name, picture: u.picture, online: u.online } : m),
            })));
          } else if (data.type === 'typing') {
            const { chat_id, user_id, is_typing } = data;
            setTyping((t) => {
              const s = new Set(t[chat_id] || []);
              if (is_typing) s.add(user_id); else s.delete(user_id);
              return { ...t, [chat_id]: s };
            });
            if (is_typing) {
              const key = `${chat_id}_${user_id}`;
              if (typingTimers.current[key]) clearTimeout(typingTimers.current[key]);
              typingTimers.current[key] = setTimeout(() => {
                setTyping((t) => {
                  const s = new Set(t[chat_id] || []);
                  s.delete(user_id);
                  return { ...t, [chat_id]: s };
                });
              }, 4000);
            }
          } else if (data.type === 'read') {
            const { chat_id, user_id } = data;
            setMessages((m) => {
              const list = (m[chat_id] || []).map((msg) => msg.read_by.includes(user_id) ? msg : { ...msg, read_by: [...msg.read_by, user_id] });
              return { ...m, [chat_id]: list };
            });
          } else if (data.type === 'presence') {
            setChats((cs) => cs.map((c) => ({
              ...c,
              members: c.members.map((m) => m.user_id === data.user_id ? { ...m, online: data.online } : m),
            })));
          }
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token, flushOutbox, refreshChats]);

  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;

  useEffect(() => { if (token) refreshChats(); }, [token, refreshChats]);

  return (
    <Ctx.Provider value={{
      chats, messages, typing, connected,
      activeChatId, setActiveChatId,
      banner, dismissBanner,
      refreshChats, loadMessages, sendMessage, editMessage, deleteMessage, deleteChat, markRead, sendTyping, createChat,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useChat() { return useContext(Ctx); }
