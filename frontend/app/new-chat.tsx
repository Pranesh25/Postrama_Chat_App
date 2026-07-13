import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, User } from '@/src/context/AuthContext';
import { useChat } from '@/src/context/ChatContext';
import { api } from '@/src/api/client';
import { Avatar } from '@/src/components/Avatar';
import { theme } from '@/src/theme';

export default function NewChat() {
  const { token } = useAuth();
  const { createChat } = useChat();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, User>>({});
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  const search = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const list = await api(`/api/users/search?q=${encodeURIComponent(query)}`, token);
      setUsers(list);
    } catch {}
    setLoading(false);
  }, [token]);

  useEffect(() => { search(''); }, [search]);
  useEffect(() => { const t = setTimeout(() => search(q), 250); return () => clearTimeout(t); }, [q, search]);

  const toggle = (u: User) => {
    setSelected((s) => {
      const n = { ...s };
      if (n[u.user_id]) delete n[u.user_id]; else n[u.user_id] = u;
      return n;
    });
  };

  const onStart = async (u?: User) => {
    if (creating) return;
    setCreating(true);
    try {
      let chat;
      if (groupMode) {
        const members = Object.keys(selected);
        if (members.length < 2) { setCreating(false); return; }
        chat = await createChat(members, true, groupName || undefined);
      } else if (u) {
        chat = await createChat([u.user_id], false);
      }
      if (chat) router.replace(`/chat/${chat.chat_id}`);
    } catch {}
    setCreating(false);
  };

  const selectedCount = Object.keys(selected).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="new-chat-screen">
      <View style={styles.header}>
        <Pressable testID="new-chat-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="close" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>{groupMode ? 'New Group' : 'New Chat'}</Text>
        <Pressable testID="toggle-group-mode" onPress={() => { setGroupMode((v) => !v); setSelected({}); }} style={styles.toggleBtn}>
          <Ionicons name={groupMode ? 'person' : 'people'} size={22} color={theme.color.brand} />
        </Pressable>
      </View>

      {groupMode && (
        <TextInput
          testID="group-name-input"
          placeholder="Group name (optional)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={groupName}
          onChangeText={setGroupName}
          style={styles.groupInput}
        />
      )}

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={theme.color.onSurfaceTertiary} />
        <TextInput
          testID="user-search-input"
          placeholder="Search by name or email"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={q}
          onChangeText={setQ}
          style={styles.search}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brand} />
      ) : (
        <FlatList
          testID="users-list"
          data={users}
          keyExtractor={(u) => u.user_id}
          contentContainerStyle={{ paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={<Text style={styles.empty}>No users found</Text>}
          renderItem={({ item }) => {
            const isSelected = !!selected[item.user_id];
            return (
              <Pressable
                testID={`user-row-${item.user_id}`}
                onPress={() => groupMode ? toggle(item) : onStart(item)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.color.surfaceTertiary }]}
              >
                <Avatar name={item.name} uri={item.picture} size={44} online={item.online} />
                <View style={{ flex: 1, marginLeft: theme.space.md }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.email}>{item.email}</Text>
                </View>
                {groupMode && (
                  <View style={[styles.check, isSelected && { backgroundColor: theme.color.brand, borderColor: theme.color.brand }]}>
                    {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}

      {groupMode && selectedCount >= 2 && (
        <Pressable testID="create-group-button" onPress={() => onStart()} style={styles.createBtn} disabled={creating}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.createText}>Create Group ({selectedCount})</Text>}
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.sm, paddingBottom: theme.space.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 22, fontFamily: theme.font.display, fontWeight: '700', color: theme.color.onSurface, textAlign: 'center' },
  toggleBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  groupInput: { marginHorizontal: theme.space.lg, marginBottom: theme.space.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: 16, paddingVertical: 12, fontFamily: theme.font.body, borderWidth: 1, borderColor: theme.color.border },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: theme.space.lg, marginBottom: theme.space.md, backgroundColor: theme.color.surfaceTertiary, borderRadius: theme.radius.pill, paddingHorizontal: 16 },
  search: { flex: 1, height: 44, fontFamily: theme.font.body, fontSize: 15, color: theme.color.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md },
  name: { fontSize: 16, fontFamily: theme.font.body, fontWeight: '600', color: theme.color.onSurface },
  email: { fontSize: 13, color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body },
  sep: { height: 1, backgroundColor: theme.color.divider, marginLeft: 76 },
  empty: { textAlign: 'center', marginTop: 40, color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  createBtn: { position: 'absolute', bottom: 24, left: 24, right: 24, height: 54, backgroundColor: theme.color.brand, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  createText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: theme.font.body },
});
