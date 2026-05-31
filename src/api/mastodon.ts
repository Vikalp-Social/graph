/**
 * Mastodon actions via the api-server (cookie session).
 * No direct calls to the Mastodon instance from the browser.
 */

export interface Post {
  id: string;
  content: string;
  imageUrl?: string;
  platform: string;
  createdAt: string;
  likes: number;
  reposts: number;
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  authorAccountId?: string;
  url?: string;
  inReplyToId?: string;
  similarity?: number;
}

export interface StatusContext {
  ancestors: Post[];
  descendants: Post[];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try { msg = (JSON.parse(text) as { error?: string }).error ?? text; } catch { msg = text; }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function favouriteStatus(
  id: string,
  on: boolean,
): Promise<{ favourites_count: number; reblogs_count: number }> {
  return apiFetch(`/api/mastodon/posts/${encodeURIComponent(id)}/${on ? "favourite" : "unfavourite"}`, { method: "POST" });
}

export async function reblogStatus(
  id: string,
  on: boolean,
): Promise<{ favourites_count: number; reblogs_count: number }> {
  return apiFetch(`/api/mastodon/posts/${encodeURIComponent(id)}/${on ? "boost" : "unboost"}`, { method: "POST" });
}

export async function postReply(id: string, content: string): Promise<{ id: string }> {
  return apiFetch(`/api/mastodon/posts/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function getStatusContext(id: string): Promise<StatusContext> {
  return apiFetch(`/api/mastodon/posts/${encodeURIComponent(id)}/context`);
}

export async function resolveStatusByUrl(url: string): Promise<Post | null> {
  try {
    return await apiFetch<Post>(`/api/mastodon/resolve?url=${encodeURIComponent(url)}`);
  } catch {
    return null;
  }
}

/** Resolves a post to its local equivalent on the user's home instance. */
export async function getLocalStatus(post: { id: string; url?: string }): Promise<{ id: string }> {
  if (post.url) {
    const resolved = await resolveStatusByUrl(post.url);
    if (resolved) return { id: resolved.id };
  }
  return { id: post.id };
}
