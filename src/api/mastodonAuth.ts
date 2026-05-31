/**
 * Auth via the api-server session (cookie-based).
 * The api-server handles OAuth with Mastodon; we just call /api/auth/* endpoints.
 */

export interface AppSession {
  loggedIn: true;
  accountId: string;
  username: string;
  displayName: string;
  avatar: string;
  instance: string;
}

export function normalizeInstance(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/+$/, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  return s;
}

/** Calls GET /api/auth/me. Returns AppSession if logged in, null otherwise. */
export async function fetchSession(): Promise<AppSession | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { loggedIn: boolean } & Partial<AppSession>;
    if (!data.loggedIn) return null;
    return data as AppSession;
  } catch {
    return null;
  }
}

/** Redirects the browser to begin Mastodon OAuth via the api-server. */
export function startLogin(instance: string): void {
  const host = normalizeInstance(instance) || "mastodon.social";
  window.location.href = `/api/auth/mastodon/begin?instance=${encodeURIComponent(host)}`;
}

/**
 * If the URL contains ?loggedin=1 (set by the api-server after OAuth callback),
 * strips it and fetches the session. Otherwise returns null.
 */
export async function handleCallbackIfPresent(): Promise<AppSession | null> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("loggedin")) return null;

  // Strip the query param without a page reload
  params.delete("loggedin");
  const newSearch = params.toString();
  const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "");
  window.history.replaceState(null, "", newUrl);

  return fetchSession();
}

/** Calls POST /api/auth/logout to clear the server-side session cookie. */
export async function clearSession(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Best-effort
  }
}
