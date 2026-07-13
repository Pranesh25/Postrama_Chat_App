import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { theme } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace('/chats');
    else router.replace('/login');
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="app-loading">
      <ActivityIndicator color={theme.color.brand} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface, alignItems: 'center', justifyContent: 'center' },
});
