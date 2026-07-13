import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { useChat } from '@/src/context/ChatContext';
import { api } from '@/src/api/client';
import { fingerprintOf, ensureKeypair } from '@/src/lib/crypto';
import { theme } from '@/src/theme';

export default function EncryptionInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = id as string;
  const { user, token } = useAuth();
  const { chats, refreshChats } = useChat();
  const router = useRouter();

  const chat = useMemo(() => chats.find((c) => c.chat_id === chatId), [chats, chatId]);
  const other = chat && !chat.is_group ? chat.members.find((m) => m.user_id !== user?.user_id) : null;

  const [otherKey, setOtherKey] = useState<string | null>(null);
  const [myKey, setMyKey] = useState<string | null>(null);
  const [fp, setFp] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const kp = await ensureKeypair();
      setMyKey(kp.publicKey);
      if (other) {
        try {
          const r = await api(`/api/users/${other.user_id}/key`, token);
          setOtherKey(r.public_key);
        } catch {}
      }
      setLoading(false);
    })();
  }, [other, token]);

  useEffect(() => {
    if (myKey && otherKey) fingerprintOf(myKey, otherKey).then(setFp);
  }, [myKey, otherKey]);

  const toggle = async (v: boolean) => {
    if (!chat || chat.is_group) { Alert.alert('Groups not supported', 'E2EE for groups isn\'t supported yet.'); return; }
    if (v && !otherKey) {
      Alert.alert('Recipient key missing', `${other?.name || 'This user'} needs to open the app once for encryption keys to sync.`);
      return;
    }
    setSaving(true);
    try {
      await api(`/api/chats/${chatId}/encryption`, token, { method: 'PATCH', body: JSON.stringify({ encrypted: v }) });
      await refreshChats();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Try again');
    } finally { setSaving(false); }
  };

  const canEncrypt = !!other && !chat?.is_group;

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="encryption-screen">
      <View style={styles.header}>
        <Pressable testID="enc-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Encryption</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.lg }}>
        <View style={styles.card}>
          <View style={styles.rowHeader}>
            <Ionicons name={chat?.encrypted ? 'lock-closed' : 'lock-open'} size={22} color={chat?.encrypted ? theme.color.success : theme.color.onSurfaceTertiary} />
            <Text style={styles.rowTitle}>End-to-end encryption</Text>
            <Switch
              testID="encryption-switch"
              value={!!chat?.encrypted}
              disabled={!canEncrypt || saving}
              onValueChange={toggle}
              thumbColor="#fff"
              trackColor={{ true: theme.color.brand, false: theme.color.borderStrong }}
            />
          </View>
          <Text style={styles.help}>
            {chat?.is_group
              ? 'End-to-end encryption is not supported for groups yet.'
              : chat?.encrypted
                ? `Messages you send from now on are encrypted with ${other?.name || 'this contact'}. The server cannot read them.`
                : `Enable to encrypt future messages with ${other?.name || 'this contact'} using their device key. The server sees only ciphertext.`}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.rowTitle}>Safety number</Text>
          <Text style={styles.help}>Compare these 25 digits with {other?.name || 'the other person'} (in person or on a call). If they match, no one is intercepting your messages.</Text>
          {loading ? (
            <ActivityIndicator color={theme.color.brand} style={{ marginTop: 16 }} />
          ) : !otherKey ? (
            <Text style={styles.fpMissing}>Recipient hasn't generated a key yet. Ask them to open the app.</Text>
          ) : (
            <Text testID="safety-number" style={styles.fpDigits}>{fp || '…'}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.rowTitle}>How to verify encryption is working</Text>
          <Text style={styles.help}>
            {'\u2022'}  Enable the toggle above and send a new text message.{'\n'}
            {'\u2022'}  Messages you send while E2EE is on show a small 🔒 lock icon in the bubble.{'\n'}
            {'\u2022'}  Ask your admin to run this MongoDB query:{'\n'}
            {'\n'}      db.messages.findOne({'{'} chat_id: "{chatId}", encrypted: true {'}'}){'\n'}
            {'\n'}    The document contains only {'{'} ciphertext, nonce, encrypted: true {'}'} — the `text` field is null. The server literally cannot decrypt your message; only the two devices in this chat can.{'\n'}
            {'\u2022'}  Compare the Safety Number above with the other person's screen. Matching = secure.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.sm },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 20, fontWeight: '700', color: theme.color.onSurface },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: theme.space.md, borderWidth: 1, borderColor: theme.color.border, gap: 10 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { flex: 1, fontFamily: theme.font.body, fontWeight: '700', fontSize: 16, color: theme.color.onSurface },
  help: { fontFamily: theme.font.body, fontSize: 13, color: theme.color.onSurfaceTertiary, lineHeight: 19 },
  fpDigits: { fontFamily: 'Courier', fontSize: 18, letterSpacing: 2, color: theme.color.onSurface, backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, padding: 12, textAlign: 'center', marginTop: 8, fontWeight: '700' },
  fpMissing: { fontFamily: theme.font.body, fontStyle: 'italic', color: theme.color.onSurfaceTertiary, marginTop: 8 },
});
