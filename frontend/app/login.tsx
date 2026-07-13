import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { theme } from '@/src/theme';

export default function Login() {
  const { signIn, demoSignIn, user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [debug, setDebug] = useState<string>('');

  useEffect(() => { if (user) router.replace('/chats'); }, [user, router]);

  const log = (s: string) => {
    console.log('[auth]', s);
    setDebug((d) => (d + '\n' + s).split('\n').slice(-6).join('\n'));
  };

  const processSessionId = useCallback(async (sid: string) => {
    log(`processing session_id=${sid.slice(0, 8)}…`);
    setLoading(true);
    try {
      await signIn(sid);
      router.replace('/chats');
    } catch (e: any) {
      log(`signIn error: ${e?.message}`);
      Alert.alert('Sign in failed', e?.message || 'Please try again');
    } finally { setLoading(false); }
  }, [signIn, router]);

  // Web: handle session_id in URL fragment
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const m = hash.match(/session_id=([^&]+)/) || search.match(/session_id=([^&]+)/);
    if (m) {
      window.history.replaceState(null, '', window.location.pathname);
      processSessionId(decodeURIComponent(m[1]));
    }
  }, [processSessionId]);

  // Mobile: cold-start deep link
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      const url = await Linking.getInitialURL();
      if (url) {
        const m = url.match(/session_id=([^&]+)/);
        if (m) processSessionId(decodeURIComponent(m[1]));
      }
    })();
    const sub = Linking.addEventListener('url', (e) => {
      const m = e.url.match(/session_id=([^&]+)/);
      if (m) processSessionId(decodeURIComponent(m[1]));
    });
    return () => sub.remove();
  }, [processSessionId]);

  const onSignIn = async () => {
    setLoading(true);
    try {
      const redirect = Platform.OS === 'web' ? window.location.origin + '/' : Linking.createURL('');
      log(`redirect=${redirect}`);
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      if (Platform.OS === 'web') {
        window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      log(`result.type=${result.type}`);
      if (result.type === 'success' && result.url) {
        log(`result.url=${result.url.slice(0, 80)}`);
        const m = result.url.match(/session_id=([^&]+)/);
        if (m) {
          await processSessionId(decodeURIComponent(m[1]));
        } else {
          log('no session_id in result.url');
          Alert.alert('Sign in failed', 'No session id returned. Redirect: ' + result.url);
        }
      } else if (result.type !== 'success') {
        // On some Android builds openAuthSessionAsync returns 'dismiss'.
        // The Linking listener will still fire — do nothing and let it handle.
        log('non-success, waiting for deep link');
      }
    } catch (e: any) {
      log(`onSignIn error: ${e?.message}`);
      Alert.alert('Error', e?.message || 'Auth error');
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.container} testID="login-screen">
      <LinearGradient colors={[theme.color.brandTertiary, theme.color.surface]} style={styles.gradient} />
      <View style={styles.content}>
        <View style={styles.logoWrap}>
          <View style={styles.logo}><Ionicons name="chatbubbles" size={64} color="#fff" /></View>
        </View>
        <Text style={styles.title}>Bubble</Text>
        <Text style={styles.subtitle}>Warm, real-time chat with your favorite people</Text>
      </View>
      <View style={styles.footer}>
        <Pressable testID="google-signin-button" onPress={onSignIn} disabled={loading} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color="#fff" />
              <Text style={styles.btnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>
        <Pressable
          testID="try-demo-button"
          onPress={async () => {
            setDemoLoading(true);
            try { await demoSignIn(); router.replace('/chats'); }
            catch (e: any) { Alert.alert('Demo error', e?.message || 'Try again'); }
            finally { setDemoLoading(false); }
          }}
          disabled={demoLoading}
          style={({ pressed }) => [styles.demoBtn, pressed && { opacity: 0.7 }]}
        >
          {demoLoading ? (
            <ActivityIndicator color={theme.color.brand} />
          ) : (
            <>
              <Ionicons name="sparkles" size={18} color={theme.color.brand} />
              <Text style={styles.demoBtnText}>Try Demo (no sign-in)</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.terms}>By continuing you agree to our Terms & Privacy Policy</Text>
        {debug ? <Text testID="auth-debug" style={styles.debug}>{debug}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  gradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 400 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  logoWrap: { alignItems: 'center', marginBottom: theme.space.xl },
  logo: { width: 120, height: 120, borderRadius: 40, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center', shadowColor: theme.color.brand, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  title: { fontSize: 48, fontFamily: theme.font.display, color: theme.color.onSurface, fontWeight: '700' },
  subtitle: { marginTop: theme.space.sm, fontSize: 16, color: theme.color.onSurfaceTertiary, textAlign: 'center', fontFamily: theme.font.body, maxWidth: 300 },
  footer: { padding: theme.space.xl, paddingBottom: theme.space.xxl },
  btn: { backgroundColor: theme.color.onSurface, borderRadius: theme.radius.pill, height: 56, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 12 },
  btnText: { color: '#fff', fontSize: 16, fontFamily: theme.font.body, fontWeight: '600' },
  demoBtn: { marginTop: theme.space.md, height: 52, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.color.brand, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  demoBtnText: { color: theme.color.brand, fontSize: 15, fontFamily: theme.font.body, fontWeight: '700' },
  terms: { textAlign: 'center', color: theme.color.onSurfaceTertiary, marginTop: theme.space.md, fontSize: 12, fontFamily: theme.font.body },
  debug: { marginTop: theme.space.md, fontFamily: 'Courier', fontSize: 10, color: theme.color.onSurfaceTertiary, textAlign: 'left' },
});
