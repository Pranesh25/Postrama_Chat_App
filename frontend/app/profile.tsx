import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Share, Platform, ActivityIndicator, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { api } from '@/src/api/client';
import { Avatar } from '@/src/components/Avatar';
import { theme } from '@/src/theme';

export default function Profile() {
  const { user, token, signOut, setUser } = useAuth();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);

  const onSignOut = async () => { await signOut(); router.replace('/login'); };

  const onChangeAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow photo access to change your avatar.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.5, allowsEditing: true, aspect: [1, 1],
    });
    if (res.canceled || !res.assets[0]?.base64) return;
    setUploading(true);
    try {
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
      const b64 = `data:image/jpeg;base64,${res.assets[0].base64}`;
      const updated = await api('/api/me', token, { method: 'PATCH', body: JSON.stringify({ picture: b64 }) });
      setUser(updated);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Try again');
    } finally { setUploading(false); }
  };

  const saveName = async () => {
    const n = nameDraft.trim();
    if (!n) return;
    setSaving(true);
    try {
      const updated = await api('/api/me', token, { method: 'PATCH', body: JSON.stringify({ name: n }) });
      setUser(updated);
      setEditingName(false);
    } catch {} finally { setSaving(false); }
  };

  const onShare = async () => {
    const link = Platform.OS === 'web'
      ? `${window.location.origin}/?share=${encodeURIComponent(user?.email || '')}`
      : `https://bubble.app/u/${encodeURIComponent(user?.email || '')}`;
    const message = `👋 Chat with me on Bubble!\n\n${user?.name}\n${user?.email}\n${link}`;
    try {
      await Share.share({ message, title: `${user?.name} on Bubble`, url: link });
    } catch {}
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="profile-screen">
      <View style={styles.header}>
        <Pressable testID="profile-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.body}>
        <Pressable testID="change-avatar-button" onPress={onChangeAvatar} disabled={uploading} style={styles.avatarWrap}>
          <Avatar name={user?.name} uri={user?.picture} size={120} />
          <View style={styles.cameraBadge}>
            {uploading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="camera" size={16} color="#fff" />}
          </View>
        </Pressable>

        {editingName ? (
          <View style={styles.nameRow}>
            <TextInput
              testID="profile-name-input"
              value={nameDraft}
              onChangeText={setNameDraft}
              style={styles.nameInput}
              autoFocus
              maxLength={40}
            />
            <Pressable testID="save-name" onPress={saveName} disabled={saving} style={styles.saveNameBtn}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="checkmark" size={18} color="#fff" />}
            </Pressable>
            <Pressable onPress={() => { setEditingName(false); setNameDraft(user?.name || ''); }} style={styles.saveNameCancel}>
              <Ionicons name="close" size={18} color={theme.color.onSurfaceTertiary} />
            </Pressable>
          </View>
        ) : (
          <Pressable testID="edit-name-button" onPress={() => { setNameDraft(user?.name || ''); setEditingName(true); }} style={styles.nameDisplay}>
            <Text style={styles.name}>{user?.name}</Text>
            <Ionicons name="pencil" size={14} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        )}
        <Text style={styles.email}>{user?.email}</Text>

        <View style={styles.actionsRow}>
          <Pressable testID="share-profile-button" onPress={onShare} style={styles.actionBtn}>
            <View style={styles.actionIcon}><Ionicons name="share-outline" size={22} color={theme.color.brand} /></View>
            <Text style={styles.actionLabel}>Share Profile</Text>
          </Pressable>
          <Pressable testID="qr-profile-button" onPress={() => Alert.alert('QR Code', 'QR sharing coming soon.')} style={styles.actionBtn}>
            <View style={styles.actionIcon}><Ionicons name="qr-code-outline" size={22} color={theme.color.brand} /></View>
            <Text style={styles.actionLabel}>My QR</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.rowItem}>
            <Ionicons name="mail-outline" size={20} color={theme.color.onSurfaceTertiary} />
            <Text style={styles.rowText}>{user?.email}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.rowItem}>
            <Ionicons name="finger-print-outline" size={20} color={theme.color.onSurfaceTertiary} />
            <Text style={styles.rowText} numberOfLines={1}>{user?.user_id}</Text>
          </View>
        </View>

        <Pressable testID="signout-button" onPress={onSignOut} style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="log-out-outline" size={20} color={theme.color.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 22, fontFamily: theme.font.display, fontWeight: '700', color: theme.color.onSurface },
  body: { alignItems: 'center', padding: theme.space.xl, gap: theme.space.md },
  avatarWrap: { position: 'relative' },
  cameraBadge: { position: 'absolute', bottom: 4, right: 4, width: 34, height: 34, borderRadius: 17, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: theme.color.surface },
  nameDisplay: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: theme.space.md },
  name: { fontSize: 24, fontFamily: theme.font.display, fontWeight: '700', color: theme.color.onSurface },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: theme.space.md, width: '100%' },
  nameInput: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, height: 44, fontFamily: theme.font.body, fontSize: 16, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  saveNameBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center' },
  saveNameCancel: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  email: { color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body },
  actionsRow: { flexDirection: 'row', gap: theme.space.md, marginTop: theme.space.md, width: '100%', justifyContent: 'center' },
  actionBtn: { alignItems: 'center', paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, borderWidth: 1, borderColor: theme.color.border, minWidth: 130 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  actionLabel: { fontFamily: theme.font.body, fontWeight: '600', color: theme.color.onSurface, fontSize: 13 },
  card: { width: '100%', backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, marginTop: theme.space.md, overflow: 'hidden' },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: theme.space.md },
  rowText: { fontFamily: theme.font.body, color: theme.color.onSurface, flex: 1 },
  divider: { height: 1, backgroundColor: theme.color.divider, marginLeft: 44 },
  signOutBtn: { marginTop: theme.space.lg, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 14, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandTertiary },
  signOutText: { color: theme.color.error, fontSize: 16, fontWeight: '700', fontFamily: theme.font.body },
});
