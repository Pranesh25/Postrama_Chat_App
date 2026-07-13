export const API = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export async function api(path: string, token: string | null, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { ...opts, headers });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`${r.status}: ${t}`);
  }
  return r.json();
}
