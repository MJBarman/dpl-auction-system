// Persisted login session (token + role) in localStorage.

export interface StoredSession {
  token: string;
  role: 'admin' | 'team';
  teamId?: string;
  teamName?: string;
}

const KEY = 'dpl-auction-session';

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!s.token || !s.role) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
