import { loadSession } from './session';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const session = loadSession();
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Sign out on the server too, so the token stops working everywhere rather
 *  than only being forgotten by this browser. Never throws and never waits
 *  more than 3 s (stalled venue Wi-Fi): offline, the token expires on its own. */
export async function signOutOnServer(): Promise<void> {
  const session = loadSession();
  if (!session) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: '{}',
      signal: abort.signal,
    });
  } catch {
    /* offline, timed out or already signed out */
  } finally {
    clearTimeout(timer);
  }
}

/** Download an admin file (CSV export, backup) with the token in a header,
 *  never in the URL, where it would sit in history and the downloads list. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const session = loadSession();
  const res = await fetch(path, { headers: session ? { Authorization: `Bearer ${session.token}` } : {} });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(message, res.status);
  }
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = named ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
