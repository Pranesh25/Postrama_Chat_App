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
  const { chats, messages, loadMessages, sendMessage, markRead, sendTyping, typing } = useChat();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [invisible, setInvisible] = useState(false);
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

  const scrollToEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

  const onSend = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText('');
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    sendTyping(chatId, false);
    await sendMessage(chatId, t);
    scrollToEnd();
    setSending(false);
  };

  const onPickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true, quality: 0.6, allowsEditing: false,
    });
    if (!res.canceled && res.assets[0]) {
      const b64 = `data:image/jpeg;base64,${res.assets[0].base64}`;
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
      await sendMessage(chatId, undefined, b64);
      scrollToEnd();
    }
  };

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

    // In invisible mode: transform text messages into audio bubbles.
    if (invisible && item.text) {
      return (
        <View style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]}>
          {!mine && chat?.is_group && (
            <View style={{ width: 32, marginRight: 8 }}>
              {showAvatar && <Avatar name={senderInfo?.name} uri={senderInfo?.picture} size={32} />}
            </View>
          )}
          <AudioBubble
            text={item.text}
            mine={mine}
            seed={item.message_id}
            playState={speech.state}
            onToggle={speech.toggle}
            timeLabel={timeStr(item.created_at)}
          />
        </View>
      );
    }

    return (
      <View style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]}>
        {!mine && chat?.is_group && (
          <View style={{ width: 32, marginRight: 8 }}>
            {showAvatar && <Avatar name={senderInfo?.name} uri={senderInfo?.picture} size={32} />}
          </View>
        )}
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          {!mine && chat?.is_group && showAvatar && (
            <Text style={styles.senderName}>{senderInfo?.name}</Text>
          )}
          {item.image && (
            <Image source={{ uri: item.image }} style={styles.msgImage} contentFit="cover" />
          )}
          {!!item.text && (
            <Text style={[styles.msgText, mine && { color: '#fff' }]}>{item.text}</Text>
          )}
          <View style={styles.msgMeta}>
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
      </View>
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
          <Pressable testID="attach-image-button" onPress={onPickImage} style={styles.attachBtn}>
            <Ionicons name="image-outline" size={22} color={theme.color.onSurfaceTertiary} />
          </Pressable>
          <TextInput
            testID="message-input"
            value={text}
            onChangeText={onChangeText}
            placeholder="Message"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
            multiline
          />
          <Pressable testID="send-button" onPress={onSend} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="arrow-up" size={22} color="#fff" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: theme.space.md, paddingTop: theme.space.sm, backgroundColor: theme.color.surfaceSecondary, borderTopWidth: 1, borderTopColor: theme.color.divider, gap: 8 },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: theme.color.surfaceTertiary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontFamily: theme.font.body, fontSize: 15, color: theme.color.onSurface },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
});
