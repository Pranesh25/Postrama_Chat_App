import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { useChat, Chat } from '@/src/context/ChatContext';
import { api } from '@/src/api/client';
import { Avatar } from '@/src/components/Avatar';
import { OverflowMenu } from '@/src/components/OverflowMenu';
import { ProfileMenu } from '@/src/components/ProfileMenu';
import { theme } from '@/src/theme';

function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

export default function ChatsScreen() {
  const { user, token } = useAuth();
  const { chats, refreshChats, markRead, connected } = useChat();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => { refreshChats(); }, [refreshChats]);

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const exitSelection = () => { setSelectionMode(false); setSelected(new Set()); };

  const markSelectedRead = async () => {
    for (const id of selected) await markRead(id);
    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    exitSelection();
  };

  const markAllRead = async () => {
    try {
      await api('/api/chats/mark-all-read', token, { method: 'POST' });
      await refreshChats();
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    } catch {}
  };

  const menuItems = [
    { key: 'select', label: 'Select chats', icon: 'checkbox-outline' as const, onPress: () => setSelectionMode(true) },
    { key: 'mark-all', label: 'Mark all as read', icon: 'checkmark-done-outline' as const, onPress: markAllRead },
    { key: 'schedule-reminder', label: 'Schedule reminder', icon: 'alarm-outline' as const, onPress: () => router.push({ pathname: '/schedule', params: { mode: 'reminder' } }) },
    { key: 'schedule-meeting', label: 'Schedule meeting', icon: 'calendar-outline' as const, onPress: () => router.push('/schedule') },
  ];

  const renderItem = ({ item }: { item: Chat }) => {
    const other = item.is_group ? null : item.members.find((m) => m.user_id !== user?.user_id) || item.members[0];
    const title = item.is_group ? (item.name || item.members.map((m) => m.name.split(' ')[0]).join(', ')) : (other?.name || 'Unknown');
    const online = !item.is_group && !!other?.online;
    const isSelected = selected.has(item.chat_id);
    return (
      <Pressable
        testID={`chat-item-${item.chat_id}`}
        onPress={() => selectionMode ? toggleSelect(item.chat_id) : router.push(`/chat/${item.chat_id}`)}
        onLongPress={() => { setSelectionMode(true); toggleSelect(item.chat_id); }}
        style={({ pressed }) => [styles.row, (pressed || isSelected) && { backgroundColor: isSelected ? theme.color.brandTertiary : theme.color.surfaceTertiary }]}
      >
        {selectionMode && (
          <View style={[styles.checkbox, isSelected && { backgroundColor: theme.color.brand, borderColor: theme.color.brand }]}>
            {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
        )}
        {item.is_group ? (
          <View style={styles.groupAvatar}><Ionicons name="people" size={22} color="#fff" /></View>
        ) : (
          <Avatar name={other?.name} uri={other?.picture} size={52} online={online} />
        )}
        <View style={{ flex: 1, marginLeft: theme.space.md }}>
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>{title}</Text>
            <Text style={styles.time}>{timeAgo(item.last_message_at)}</Text>
          </View>
          <View style={styles.rowBot}>
            <Text style={[styles.preview, item.unread > 0 && { color: theme.color.onSurface, fontWeight: '600' }]} numberOfLines={1}>
              {item.last_message || 'Start the conversation'}
            </Text>
            {item.unread > 0 && (
              <View style={styles.badge}><Text style={styles.badgeText}>{item.unread}</Text></View>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} testID="chats-screen" edges={['top']}>
      <View style={styles.header}>
        {selectionMode ? (
          <>
            <Pressable testID="selection-cancel" onPress={exitSelection} style={styles.iconBtn}>
              <Ionicons name="close" size={24} color={theme.color.onSurface} />
            </Pressable>
            <Text style={styles.selCount}>{selected.size} selected</Text>
            <Pressable testID="selection-mark-read" onPress={markSelectedRead} disabled={selected.size === 0} style={[styles.iconBtn, selected.size === 0 && { opacity: 0.4 }]}>
              <Ionicons name="checkmark-done" size={22} color={theme.color.brand} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable testID="menu-button" onPress={() => setMenuOpen(true)} style={styles.iconBtn}>
              <Ionicons name="ellipsis-vertical" size={22} color={theme.color.onSurface} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'flex-start', marginLeft: 4 }}>
              <Text style={styles.hello}>Hi, {user?.name?.split(' ')[0] || 'there'} 👋</Text>
              <View style={styles.statusRow}>
                <View style={[styles.connDot, { backgroundColor: connected ? theme.color.success : theme.color.muted }]} />
                <Text style={styles.statusText}>{connected ? 'Online' : 'Connecting…'}</Text>
              </View>
            </View>
            <Pressable testID="profile-button" onPress={() => setProfileOpen(true)} style={styles.avatarBtn}>
              <Avatar name={user?.name} uri={user?.picture} size={36} />
            </Pressable>
          </>
        )}
      </View>

      <FlatList
        testID="chats-list"
        data={chats}
        keyExtractor={(c) => c.chat_id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 120 }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refreshChats} tintColor={theme.color.brand} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={48} color={theme.color.brand} /></View>
            <Text style={styles.emptyTitle}>No chats yet</Text>
            <Text style={styles.emptySub}>Tap the button below to start a new conversation.</Text>
          </View>
        }
      />

      {!selectionMode && (
        <Pressable testID="new-chat-fab" onPress={() => router.push('/new-chat')} style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.96 }] }]}>
          <Ionicons name="create" size={26} color="#fff" />
        </Pressable>
      )}

      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} anchor="left" />
      <ProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.space.sm, paddingTop: theme.space.sm, paddingBottom: theme.space.sm, flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  avatarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hello: { fontSize: 22, fontFamily: theme.font.display, fontWeight: '700', color: theme.color.onSurface },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body, fontSize: 12 },
  selCount: { flex: 1, textAlign: 'center', fontSize: 16, fontFamily: theme.font.body, fontWeight: '700', color: theme.color.onSurface },
  row: { paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.color.borderStrong, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  name: { fontSize: 16, fontFamily: theme.font.body, fontWeight: '600', color: theme.color.onSurface, flex: 1 },
  time: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body, marginLeft: 8 },
  preview: { color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body, fontSize: 14, flex: 1 },
  badge: { backgroundColor: theme.color.brand, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: theme.font.body },
  separator: { height: 1, backgroundColor: theme.color.divider, marginLeft: 84 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 60, height: 60, borderRadius: 30, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center', shadowColor: theme.color.brand, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  groupAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.color.brandSecondary, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: theme.space.xl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.lg },
  emptyTitle: { fontSize: 20, fontFamily: theme.font.display, fontWeight: '700', color: theme.color.onSurface },
  emptySub: { textAlign: 'center', color: theme.color.onSurfaceTertiary, marginTop: 8, fontFamily: theme.font.body },
});
