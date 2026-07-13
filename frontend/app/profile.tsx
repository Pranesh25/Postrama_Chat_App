import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { Avatar } from '@/src/components/Avatar';
import { theme } from '@/src/theme';

export default function Profile() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const onSignOut = async () => {
    await signOut();
    router.replace('/login');
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
        <Avatar name={user?.name} uri={user?.picture} size={120} />
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>

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
  name: { fontSize: 24, fontFamily: theme.font.display, fontWeight: '700', color: theme.color.onSurface, marginTop: theme.space.md },
  email: { color: theme.color.onSurfaceTertiary, fontFamily: theme.font.body },
  card: { width: '100%', backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, marginTop: theme.space.lg, overflow: 'hidden' },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: theme.space.md },
  rowText: { fontFamily: theme.font.body, color: theme.color.onSurface, flex: 1 },
  divider: { height: 1, backgroundColor: theme.color.divider, marginLeft: 44 },
  signOutBtn: { marginTop: theme.space.xl, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 14, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandTertiary },
  signOutText: { color: theme.color.error, fontSize: 16, fontWeight: '700', fontFamily: theme.font.body },
});
