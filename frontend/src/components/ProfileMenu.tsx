import React, { useEffect, useState, useCallback } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, FlatList, TextInput, ActivityIndicator, Linking, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { api } from '../api/client';
import { Avatar } from './Avatar';
import { theme } from '../theme';

type PhoneContact = { id: string; name: string; phone?: string; email?: string; bubbleUser?: any };

export function ProfileMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, token } = useAuth();
  const { createChat } = useChat();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState<Contacts.PermissionStatus | null>(null);
  const [q, setQ] = useState('');
  const [addingEmail, setAddingEmail] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const loadContacts = useCallback(async () => {
    if (Platform.OS === 'web') { setPermission(Contacts.PermissionStatus.DENIED); return; }
    setLoading(true);
    const { status } = await Contacts.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Contacts.requestPermissionsAsync();
      setPermission(req.status);
      if (req.status !== 'granted') { setLoading(false); return; }
    } else setPermission(status);

    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails, Contacts.Fields.Name],
        sort: Contacts.SortTypes.FirstName,
      });
      const clean: PhoneContact[] = (data || [])
        .filter((c) => c.name && (c.phoneNumbers?.length || c.emails?.length))
        .map((c) => ({
          id: c.id || `${c.name}_${Math.random()}`,
          name: c.name || 'Unknown',
          phone: c.phoneNumbers?.[0]?.number || undefined,
          email: c.emails?.[0]?.email || undefined,
        }));

      // match against bubble users by email
      const emails = clean.map((c) => c.email).filter(Boolean);
      if (emails.length > 0 && token) {
        const found = await api(`/api/users/search?q=`, token).catch(() => []);
        const byEmail: Record<string, any> = {};
        (found as any[]).forEach((u) => { byEmail[u.email.toLowerCase()] = u; });
        clean.forEach((c) => {
          if (c.email && byEmail[c.email.toLowerCase()]) c.bubbleUser = byEmail[c.email.toLowerCase()];
        });
      }
      setContacts(clean);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { if (visible) loadContacts(); }, [visible, loadContacts]);

  const startChatWithBubble = async (u: any) => {
    onClose();
    const chat = await createChat([u.user_id], false);
    if (chat) router.push(`/chat/${chat.chat_id}`);
  };

  const inviteContact = async (c: PhoneContact) => {
    const msg = `Hey ${c.name.split(' ')[0]}! Join me on Bubble — a warm little chat app.`;
    if (c.phone) {
      const url = `sms:${c.phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(msg)}`;
      const ok = await Linking.canOpenURL(url);
      if (ok) Linking.openURL(url);
    } else if (c.email) {
      const url = `mailto:${c.email}?subject=${encodeURIComponent('Join me on Bubble')}&body=${encodeURIComponent(msg)}`;
      Linking.openURL(url);
    }
  };

  const addNewContact = async () => {
    const email = addingEmail.trim().toLowerCase();
    if (!email) return;
    try {
      const list = await api(`/api/users/search?q=${encodeURIComponent(email)}`, token);
      const found = (list as any[]).find((u) => u.email.toLowerCase() === email) || (list as any[])[0];
      if (found) {
        setAddingEmail(''); setShowAdd(false);
        await startChatWithBubble(found);
      }
    } catch {}
  };

  const filtered = q ? contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : contacts;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <View style={[styles.sheet, { paddingTop: insets.top + 8 }]} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                <Avatar name={user?.name} uri={user?.picture} size={40} />
                <View>
                  <Text style={styles.userName}>{user?.name}</Text>
                  <Text style={styles.userEmail}>{user?.email}</Text>
                </View>
              </View>
              <Pressable testID="profile-menu-close" onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable testID="menu-new-group" onPress={() => { onClose(); setTimeout(() => router.push({ pathname: '/new-chat', params: { group: '1' } }), 60); }} style={styles.actionBtn}>
              <View style={styles.actionIcon}><Ionicons name="people" size={22} color={theme.color.brand} /></View>
              <Text style={styles.actionLabel}>New Group</Text>
            </Pressable>
            <Pressable testID="menu-new-contact" onPress={() => setShowAdd((v) => !v)} style={styles.actionBtn}>
              <View style={styles.actionIcon}><Ionicons name="person-add" size={22} color={theme.color.brand} /></View>
              <Text style={styles.actionLabel}>New Contact</Text>
            </Pressable>
            <Pressable testID="menu-view-profile" onPress={() => { onClose(); setTimeout(() => router.push('/profile'), 60); }} style={styles.actionBtn}>
              <View style={styles.actionIcon}><Ionicons name="person" size={22} color={theme.color.brand} /></View>
              <Text style={styles.actionLabel}>View Profile</Text>
            </Pressable>
          </View>

          {showAdd && (
            <View style={styles.addRow}>
              <TextInput
                testID="new-contact-email-input"
                value={addingEmail}
                onChangeText={setAddingEmail}
                placeholder="Enter email to find on Bubble"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={styles.addInput}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Pressable testID="new-contact-search-button" onPress={addNewContact} style={styles.addBtn}>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </Pressable>
            </View>
          )}

          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>Phone Contacts</Text>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={theme.color.onSurfaceTertiary} />
            <TextInput
              testID="phone-contacts-search"
              value={q}
              onChangeText={setQ}
              placeholder="Search contacts"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={styles.searchInput}
            />
          </View>

          {loading ? (
            <ActivityIndicator color={theme.color.brand} style={{ marginTop: 24 }} />
          ) : permission !== 'granted' ? (
            <View style={styles.permBox}>
              <Text style={styles.permText}>Contacts permission is needed to show your phone contacts.</Text>
              <Pressable testID="grant-contacts-permission" onPress={loadContacts} style={styles.grantBtn}>
                <Text style={styles.grantText}>Grant Access</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              testID="phone-contacts-list"
              data={filtered}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              ItemSeparatorComponent={() => <View style={styles.rowSep} />}
              renderItem={({ item }) => (
                <View style={styles.contactRow}>
                  <Avatar name={item.name} size={40} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.contactSub}>{item.bubbleUser ? 'On Bubble' : (item.phone || item.email || '')}</Text>
                  </View>
                  {item.bubbleUser ? (
                    <Pressable testID={`chat-with-${item.id}`} onPress={() => startChatWithBubble(item.bubbleUser)} style={styles.chatBtn}>
                      <Text style={styles.chatBtnText}>Chat</Text>
                    </Pressable>
                  ) : (
                    <Pressable testID={`invite-${item.id}`} onPress={() => inviteContact(item)} style={styles.inviteBtn}>
                      <Text style={styles.inviteText}>Invite</Text>
                    </Pressable>
                  )}
                </View>
              )}
              ListEmptyComponent={<Text style={styles.empty}>No contacts</Text>}
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', top: 0, right: 0, width: '88%', height: '100%', backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderBottomLeftRadius: 24, paddingHorizontal: 16 },
  header: { paddingBottom: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border, marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  userName: { fontFamily: theme.font.display, fontWeight: '700', fontSize: 16, color: theme.color.onSurface },
  userEmail: { fontFamily: theme.font.body, fontSize: 12, color: theme.color.onSurfaceTertiary },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12 },
  actionBtn: { alignItems: 'center', flex: 1 },
  actionIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  actionLabel: { fontSize: 12, fontFamily: theme.font.body, color: theme.color.onSurface, textAlign: 'center' },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  addInput: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, height: 44, fontFamily: theme.font.body, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: theme.color.divider, marginVertical: 12 },
  sectionTitle: { fontFamily: theme.font.body, fontSize: 13, fontWeight: '700', color: theme.color.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.color.surfaceTertiary, borderRadius: 20, paddingHorizontal: 12, height: 40, marginBottom: 8 },
  searchInput: { flex: 1, fontFamily: theme.font.body, fontSize: 14, color: theme.color.onSurface },
  contactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  contactName: { fontFamily: theme.font.body, fontWeight: '600', fontSize: 15, color: theme.color.onSurface },
  contactSub: { fontFamily: theme.font.body, fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  rowSep: { height: 1, backgroundColor: theme.color.divider, marginLeft: 52 },
  chatBtn: { backgroundColor: theme.color.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  chatBtnText: { color: '#fff', fontFamily: theme.font.body, fontWeight: '700', fontSize: 12 },
  inviteBtn: { backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  inviteText: { color: theme.color.onSurface, fontFamily: theme.font.body, fontWeight: '600', fontSize: 12 },
  permBox: { padding: 16, alignItems: 'center' },
  permText: { fontFamily: theme.font.body, color: theme.color.onSurfaceTertiary, textAlign: 'center', marginBottom: 12 },
  grantBtn: { backgroundColor: theme.color.brand, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  grantText: { color: '#fff', fontFamily: theme.font.body, fontWeight: '700' },
  empty: { textAlign: 'center', color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body, marginTop: 24 },
});
