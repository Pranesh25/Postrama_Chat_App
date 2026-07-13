import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useAuth } from '@/src/context/AuthContext';
import { useChat, Message } from '@/src/context/ChatContext';
import { Avatar } from '@/src/components/Avatar';
import { AudioBubble, useMessageSpeech } from '@/src/components/AudioBubble';
import { MessageActionsSheet } from '@/src/components/MessageActionsSheet';
import { ReactionsBar, ReactionsRow } from '@/src/components/Reactions';
import { AttachSheet, Attach } from '@/src/components/AttachSheet';
import { VoiceRecorderButton } from '@/src/components/VoiceRecorderButton';
import { VoiceMessageBubble } from '@/src/components/VoiceMessageBubble';
import { theme } from '@/src/theme';

function timeStr(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase() + '.';
  const first = parts[0][0]?.toUpperCase() || '';
  const last = parts[parts.length - 1][0]?.toUpperCase() || '';
  return `${first}.${last}.`;
}

export default function ChatRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = id as string;
  const { user } = useAuth();
  const { chats, messages, loadMessages, sendMessage, editMessage, deleteMessage, markRead, sendTyping, typing, setActiveChatId, toggleReaction } = useChat();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [invisible, setInvisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const listRef = useRef<FlatList>(null);
  const speech = useMessageSpeech();
  const speechStop = speech.stop;

  const chat = useMemo(() => chats.find((c) => c.chat_id === chatId), [chats, chatId]);
  const other = chat && !chat.is_group ? chat.members.find((m) => m.user_id !== user?.user_id) : null;
  const title = chat?.is_group ? (chat.name || chat.members.map((m) => m.name.split(' ')[0]).join(', ')) : other?.name || 'Chat';
  const list = messages[chatId] || [];
  const typingUsers = Array.from(typing[chatId] || []).filter((u) => u !== user?.user_id);

  useEffect(() => { loadMessages(chatId); }, [chatId, loadMessages]);
  useEffect(() => { if (list.length > 0) markRead(chatId); }, [list.length, chatId, markRead]);
  useEffect(() => { if (!invisible) speechStop(); }, [invisible, speechStop]);
  useEffect(() => { setActiveChatId(chatId); return () => setActiveChatId(null); }, [chatId, setActiveChatId]);

  const scrollToEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

  const onSend = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    sendTyping(chatId, false);
    if (editingId) {
      await editMessage(editingId, t);
      setEditingId(null);
    } else {
      await sendMessage(chatId, { text: t, reply_to: replyTo?.message_id });
      setReplyTo(null);
    }
    setText('');
    scrollToEnd();
    setSending(false);
  };

  const onReplySelected = () => {
    if (!selectedMsg) return;
    setReplyTo(selectedMsg);
    setSelectedMsg(null);
  };

  const onReactSelected = async (emoji: string) => {
    if (!selectedMsg) return;
    await toggleReaction(selectedMsg.message_id, emoji);
    setSelectedMsg(null);
  };

  const openActions = (m: Message) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    setSelectedMsg(m);
  };

  const onDeleteSelected = () => {
    if (!selectedMsg) return;
    deleteMessage(selectedMsg.message_id);
    setSelectedMsg(null);
  };

  const onEditSelected = () => {
    if (!selectedMsg) return;
    const t = selectedMsg.decrypted_text || selectedMsg.text;
    if (!t) return;
    setEditingId(selectedMsg.message_id);
    setText(t);
    setSelectedMsg(null);
  };

  const onAttach = async (a: Attach) => {
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    if (a.kind === 'image') await sendMessage(chatId, { image: a.data, reply_to: replyTo?.message_id });
    else if (a.kind === 'file') await sendMessage(chatId, { file: { name: a.name, mime: a.mime, data: a.data, size: a.size }, reply_to: replyTo?.message_id });
    else if (a.kind === 'contact') await sendMessage(chatId, { contact: { name: a.name, phone: a.phone, email: a.email }, reply_to: replyTo?.message_id });
    setReplyTo(null);
    scrollToEnd();
  };

  const onSendVoice = async (b64: string, dur: number) => {
    await sendMessage(chatId, { voice: b64, voice_duration: dur, reply_to: replyTo?.message_id });
    setReplyTo(null);
    scrollToEnd();
  };

  const onPickImage = async () => setAttachOpen(true);

  const typingTimerRef = useRef<any>(null);
  const onChangeText = (v: string) => {
    setText(v);
    sendTyping(chatId, true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => sendTyping(chatId, false), 2500);
  };

  const renderMsg = ({ item, index }: { item: Message; index: number }) => {
    const mine = item.sender_id === user?.user_id;
    const senderInfo = chat?.members.find((m) => m.user_id === item.sender_id);
    const prev = index > 0 ? list[index - 1] : null;
    const showAvatar = !mine && chat?.is_group && (!prev || prev.sender_id !== item.sender_id);
    const readByOther = chat && item.read_by.some((u) => u !== user?.user_id);
    const displayText = item.encrypted ? (item.decrypted_text || null) : (item.text || null);
    const decryptFailed = item.encrypted && !item.decrypted_text;
    const repliedTo = item.reply_to ? list.find((m) => m.message_id === item.reply_to) : null;

    // Voice message
    if (item.voice && item.voice_duration) {
      return (
        <Pressable onLongPress={() => openActions(item)} delayLongPress={280} style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]} testID={`msg-row-${item.message_id}`}>
          {!mine && chat?.is_group && (
            <View style={{ width: 32, marginRight: 8 }}>{showAvatar && <Avatar name={senderInfo?.name} uri={senderInfo?.picture} size={32} />}</View>
          )}
          <View>
            <VoiceMessageBubble b64={item.voice} duration={item.voice_duration} mine={mine} seed={item.message_id} />
            <ReactionsRow reactions={item.reactions || {}} currentUserId={user?.user_id || ''} onToggle={(e) => toggleReaction(item.message_id, e)} />
          </View>
        </Pressable>
      );
    }

    // File message
    if (item.file) {
      const sizeKB = Math.max(1, Math.round((item.file.size || 0) / 1024));
      return (
        <Pressable onLongPress={() => openActions(item)} delayLongPress={280} style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]} testID={`msg-row-${item.message_id}`}>
          {!mine && chat?.is_group && <View style={{ width: 32, marginRight: 8 }}>{showAvatar && <Avatar name={senderInfo?.name} uri={senderInfo?.picture} size={32} />}</View>}
          <View>
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <View style={[styles.fileIcon, { backgroundColor: mine ? 'rgba(255,255,255,0.25)' : theme.color.brand }]}>
                <Ionicons name="document-text" size={20} color="#fff" />
              </View>
              <View style={{ maxWidth: 200 }}>
                <Text style={[styles.msgText, mine && { color: '#fff' }]} numberOfLines={1}>{item.file.name}</Text>
                <Text style={[styles.msgTime, mine && { color: 'rgba(255,255,255,0.75)' }]}>{sizeKB} KB · {item.file.mime.split('/')[1] || 'file'}</Text>
              </View>
            </View>
            <ReactionsRow reactions={item.reactions || {}} currentUserId={user?.user_id || ''} onToggle={(e) => toggleReaction(item.message_id, e)} />
          </View>
        </Pressable>
      );
    }

    // Contact card
    if (item.contact) {
      return (
        <Pressable onLongPress={() => openActions(item)} delayLongPress={280} style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]} testID={`msg-row-${item.message_id}`}>
          {!mine && chat?.is_group && <View style={{ width: 32, marginRight: 8 }}>{showAvatar && <Avatar name={senderInfo?.name} uri={senderInfo?.picture} size={32} />}</View>}
          <View>
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, { paddingVertical: 12 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={item.contact.name} size={40} />
                <View>
                  <Text style={[styles.msgText, mine && { color: '#fff' }, { fontWeight: '700' }]}>{item.contact.name}</Text>
                  {item.contact.phone && <Text style={[styles.msgTime, mine && { color: 'rgba(255,255,255,0.75)' }]}>{item.contact.phone}</Text>}
                  {item.contact.email && <Text style={[styles.msgTime, mine && { color: 'rgba(255,255,255,0.75)' }]}>{item.contact.email}</Text>}
                </View>
              </View>
            </View>
            <ReactionsRow reactions={item.reactions || {}} currentUserId={user?.user_id || ''} onToggle={(e) => toggleReaction(item.message_id, e)} />
          </View>
        </Pressable>
      );
    }

    // In invisible mode: transform text messages into audio bubbles.
    if (invisible && (displayText || item.text)) {
      return (
        <Pressable onLongPress={() => openActions(item)} delayLongPress={280} style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]} testID={`msg-row-${item.message_id}`}>
          {!mine && chat?.is_group && <View style={{ width: 32, marginRight: 8 }}>{showAvatar && <Avatar name={senderInfo?.name} uri={senderInfo?.picture} size={32} />}</View>}
          <AudioBubble text={displayText || item.text || ''} mine={mine} seed={item.message_id} playState={speech.state} onToggle={speech.toggle} timeLabel={timeStr(item.created_at)} />
        </Pressable>
      );
    }

    return (
      <Pressable
        onLongPress={() => openActions(item)}
        delayLongPress={280}
        style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]}
        testID={`msg-row-${item.message_id}`}
      >
        {!mine && chat?.is_group && (
          <View style={{ width: 32, marginRight: 8 }}>
            {showAvatar && <Avatar name={senderInfo?.name} uri={senderInfo?.picture} size={32} />}
          </View>
        )}
        <View style={{ maxWidth: '80%' }}>
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
            {!mine && chat?.is_group && showAvatar && (
              <Text style={styles.senderName}>{senderInfo?.name}</Text>
            )}
            {repliedTo && (
              <View style={[styles.replyQuote, mine && { borderLeftColor: 'rgba(255,255,255,0.6)' }]}>
                <Text style={[styles.replyAuthor, mine && { color: 'rgba(255,255,255,0.9)' }]}>
                  {repliedTo.sender_id === user?.user_id ? 'You' : chat?.members.find((m) => m.user_id === repliedTo.sender_id)?.name?.split(' ')[0] || 'Someone'}
                </Text>
                <Text style={[styles.replyText, mine && { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={2}>
                  {repliedTo.decrypted_text || repliedTo.text || (repliedTo.voice ? '🎤 Voice' : repliedTo.image ? '📷 Photo' : repliedTo.file ? `📎 ${repliedTo.file.name}` : repliedTo.contact ? `👤 ${repliedTo.contact.name}` : '')}
                </Text>
              </View>
            )}
            {item.image && (
              <Image source={{ uri: item.image }} style={styles.msgImage} contentFit="cover" />
            )}
            {decryptFailed ? (
              <Text style={[styles.msgText, mine && { color: '#fff' }, { fontStyle: 'italic', opacity: 0.7 }]}>🔒 Unable to decrypt</Text>
            ) : !!displayText && (
              <Text style={[styles.msgText, mine && { color: '#fff' }]}>{displayText}</Text>
            )}
            <View style={styles.msgMeta}>
              {item.encrypted && <Ionicons name="lock-closed" size={10} color={mine ? 'rgba(255,255,255,0.75)' : theme.color.onSurfaceTertiary} />}
              {item.edited_at && (<Text style={[styles.msgTime, mine && { color: 'rgba(255,255,255,0.75)' }, { fontStyle: 'italic' }]}>edited</Text>)}
              <Text style={[styles.msgTime, mine && { color: 'rgba(255,255,255,0.75)' }]}>{timeStr(item.created_at)}</Text>
              {mine && (
                item.pending
                  ? <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.85)" />
                  : readByOther
                    ? <Ionicons name="checkmark-done" size={14} color="#B6F3D0" />
                    : <Ionicons name="checkmark" size={14} color="rgba(255,255,255,0.85)" />
              )}
            </View>
          </View>
          <ReactionsRow reactions={item.reactions || {}} currentUserId={user?.user_id || ''} onToggle={(e) => toggleReaction(item.message_id, e)} />
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="chat-room">
      <View style={styles.header}>
        {invisible ? (
          <>
            <Pressable testID="chat-back-button" onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
            </Pressable>
            <View style={{ flex: 1, marginLeft: theme.space.sm }}>
              <Text style={styles.headerName} numberOfLines={1}>{initials(title)}</Text>
              <Text style={styles.headerSub}>🔇 Invisible mode</Text>
            </View>
            <Pressable
              testID="invisible-toggle"
              onPress={() => {
                setInvisible(false);
                try { Haptics.selectionAsync(); } catch {}
              }}
              style={[styles.invisibleBtn, styles.invisibleBtnOn]}
            >
              <Ionicons name="eye-off" size={18} color="#fff" />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable testID="chat-back-button" onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
            </Pressable>
            {chat?.is_group ? (
              <View style={styles.groupHeaderAvatar}><Ionicons name="people" size={20} color="#fff" /></View>
            ) : (
              <Avatar name={other?.name} uri={other?.picture} size={40} online={!!other?.online} />
            )}
            <View style={{ flex: 1, marginLeft: theme.space.md }}>
              <Text style={styles.headerName} numberOfLines={1}>{title}</Text>
              <Text style={styles.headerSub}>
                {typingUsers.length > 0
                  ? 'typing…'
                  : chat?.is_group
                    ? `${chat.members.length} members`
                    : other?.online ? 'online' : 'offline'}
              </Text>
            </View>
            <Pressable
              testID="encryption-info-button"
              onPress={() => router.push(`/chat-encryption/${chatId}`)}
              style={styles.headerIconBtn}
            >
              <Ionicons name={chat?.encrypted ? 'lock-closed' : 'lock-open-outline'} size={20} color={chat?.encrypted ? theme.color.success : theme.color.onSurface} />
            </Pressable>
            <Pressable
              testID="call-audio-button"
              onPress={() => Alert.alert('Audio call', 'Voice calls are coming soon.')}
              style={styles.headerIconBtn}
            >
              <Ionicons name="call" size={20} color={theme.color.onSurface} />
            </Pressable>
            <Pressable
              testID="call-video-button"
              onPress={() => Alert.alert('Video call', 'Video calls are coming soon.')}
              style={styles.headerIconBtn}
            >
              <Ionicons name="videocam" size={22} color={theme.color.onSurface} />
            </Pressable>
            <Pressable
              testID="invisible-toggle"
              onPress={() => {
                setInvisible(true);
                try { Haptics.selectionAsync(); } catch {}
              }}
              style={styles.invisibleBtn}
            >
              <Ionicons name="eye-outline" size={18} color={theme.color.onSurface} />
            </Pressable>
          </>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <FlatList
          testID="messages-list"
          ref={listRef}
          data={list}
          keyExtractor={(m) => m.message_id}
          renderItem={renderMsg}
          contentContainerStyle={{ paddingVertical: theme.space.md, paddingHorizontal: theme.space.md }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.emptyChat}>Say hi 👋</Text>}
        />

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {replyTo && (
            <View style={styles.editingBar} testID="reply-bar">
              <Ionicons name="return-up-back" size={16} color={theme.color.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarAuthor}>Replying to {replyTo.sender_id === user?.user_id ? 'yourself' : chat?.members.find((m) => m.user_id === replyTo.sender_id)?.name?.split(' ')[0] || 'user'}</Text>
                <Text style={styles.editingText} numberOfLines={1}>
                  {replyTo.decrypted_text || replyTo.text || (replyTo.voice ? '🎤 Voice' : replyTo.image ? '📷 Photo' : replyTo.file ? `📎 ${replyTo.file.name}` : replyTo.contact ? `👤 ${replyTo.contact.name}` : '')}
                </Text>
              </View>
              <Pressable testID="cancel-reply-button" onPress={() => setReplyTo(null)} style={styles.editingCancel}>
                <Ionicons name="close" size={16} color={theme.color.onSurfaceTertiary} />
              </Pressable>
            </View>
          )}
          {editingId && (
            <View style={styles.editingBar} testID="editing-bar">
              <Ionicons name="create-outline" size={16} color={theme.color.brand} />
              <Text style={styles.editingText} numberOfLines={1}>Editing message…</Text>
              <Pressable testID="cancel-edit-button" onPress={() => { setEditingId(null); setText(''); }} style={styles.editingCancel}>
                <Ionicons name="close" size={16} color={theme.color.onSurfaceTertiary} />
              </Pressable>
            </View>
          )}
          <View style={styles.composerRow}>
            <Pressable testID="attach-image-button" onPress={onPickImage} style={styles.attachBtn} disabled={!!editingId}>
              <Ionicons name="add-circle-outline" size={26} color={editingId ? theme.color.borderStrong : theme.color.onSurfaceTertiary} />
            </Pressable>
            <TextInput
              testID="message-input"
              value={text}
              onChangeText={onChangeText}
              placeholder={editingId ? 'Edit message' : 'Message'}
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.input}
              multiline
            />
            {text.trim() || editingId ? (
              <Pressable testID="send-button" onPress={onSend} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>
                {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name={editingId ? 'checkmark' : 'arrow-up'} size={22} color="#fff" />}
              </Pressable>
            ) : (
              <VoiceRecorderButton onSend={onSendVoice} />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <MessageActionsSheet
        visible={!!selectedMsg}
        onClose={() => setSelectedMsg(null)}
        canEdit={selectedMsg?.sender_id === user?.user_id && !!(selectedMsg?.text || selectedMsg?.decrypted_text)}
        canDelete={selectedMsg?.sender_id === user?.user_id}
        canReply={true}
        reactions={selectedMsg?.reactions || {}}
        currentUserId={user?.user_id || ''}
        messageText={selectedMsg?.decrypted_text || selectedMsg?.text}
        onEdit={onEditSelected}
        onDelete={onDeleteSelected}
        onReply={onReplySelected}
        onReact={onReactSelected}
      />
      <AttachSheet visible={attachOpen} onClose={() => setAttachOpen(false)} onPick={onAttach} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.sm, paddingVertical: theme.space.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider, backgroundColor: theme.color.surfaceSecondary },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerName: { fontSize: 16, fontFamily: theme.font.body, fontWeight: '700', color: theme.color.onSurface },
  headerSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body, marginTop: 2 },
  groupHeaderAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandSecondary, alignItems: 'center', justifyContent: 'center' },
  msgRow: { flexDirection: 'row', marginVertical: 3 },
  msgLeft: { justifyContent: 'flex-start' },
  msgRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', paddingHorizontal: theme.space.md, paddingVertical: 8, borderRadius: 20 },
  bubbleMine: { backgroundColor: theme.color.brand, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: theme.color.surfaceSecondary, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: theme.color.divider },
  senderName: { fontSize: 12, color: theme.color.brand, fontWeight: '700', marginBottom: 2, fontFamily: theme.font.body },
  msgText: { fontSize: 15, color: theme.color.onSurface, fontFamily: theme.font.body },
  msgImage: { width: 220, height: 220, borderRadius: 14, marginBottom: 6 },
  msgMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 2 },
  msgTime: { fontSize: 10, color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body },
  emptyChat: { textAlign: 'center', color: theme.color.onSurfaceTertiary, marginTop: 60, fontFamily: theme.font.body },
  composer: { paddingHorizontal: theme.space.md, paddingTop: theme.space.sm, backgroundColor: theme.color.surfaceSecondary, borderTopWidth: 1, borderTopColor: theme.color.divider },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  editingBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, backgroundColor: theme.color.brandTertiary, borderRadius: 12 },
  editingText: { flex: 1, color: theme.color.onSurface, fontFamily: theme.font.body, fontSize: 13, fontWeight: '600' },
  editingCancel: { padding: 4 },
  replyBarAuthor: { color: theme.color.brand, fontFamily: theme.font.body, fontSize: 12, fontWeight: '700' },
  replyQuote: { borderLeftWidth: 3, borderLeftColor: theme.color.brand, paddingLeft: 8, marginBottom: 6, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 6, padding: 6 },
  replyAuthor: { fontFamily: theme.font.body, fontSize: 11, fontWeight: '700', color: theme.color.brand },
  replyText: { fontFamily: theme.font.body, fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  fileIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: theme.color.surfaceTertiary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontFamily: theme.font.body, fontSize: 15, color: theme.color.onSurface },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
});
