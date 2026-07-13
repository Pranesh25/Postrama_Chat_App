import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  online?: boolean;
  last_seen?: string | null;
};

type AuthState = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (session_id: string) => Promise<void>;
  demoSignIn: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
};

const AuthCtx = createContext<AuthState>({} as AuthState);

const TOKEN_KEY = 'bubble_session_token';

async function storeToken(t: string | null) {
  if (Platform.OS === 'web') {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } else {
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

async function readToken(): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(TOKEN_KEY);
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (t: string) => {
    try {
      const r = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) {
        const u = await r.json();
        setUserState(u);
        setToken(t);
      } else {
        await storeToken(null);
        setToken(null);
      }
    } catch (e) {
      // keep token, offline
      setToken(t);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await readToken();
      if (t) await loadMe(t);
      setLoading(false);
    })();
  }, [loadMe]);

  const signIn = useCallback(async (session_id: string) => {
    const r = await fetch(`${API}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id }),
    });
    if (!r.ok) throw new Error('Auth failed');
    const data = await r.json();
    await storeToken(data.session_token);
    setToken(data.session_token);
    setUserState(data.user);
  }, []);

  const demoSignIn = useCallback(async () => {
    const r = await fetch(`${API}/api/demo-login`, { method: 'POST' });
    if (!r.ok) throw new Error('Demo login failed');
    const data = await r.json();
    await storeToken(data.session_token);
    setToken(data.session_token);
    setUserState(data.user);
  }, []);

  const signOut = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch {}
    }
    await storeToken(null);
    setToken(null);
    setUserState(null);
  }, [token]);

  return (
    <AuthCtx.Provider value={{ user, token, loading, signIn, demoSignIn, signOut, setUser: setUserState }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
