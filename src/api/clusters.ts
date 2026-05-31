import type { ClustersResponse, FeedSource } from "../types/clusters";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cacheKey = (source: FeedSource) => `vg.clusters.v1:${source}`;

interface CacheEntry {
  data: ClustersResponse;
  cachedAt: number;
}

function readCache(source: FeedSource): ClustersResponse | null {
  try {
    const raw = localStorage.getItem(cacheKey(source));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(source));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache(source: FeedSource, data: ClustersResponse): void {
  try {
    localStorage.setItem(cacheKey(source), JSON.stringify({ data, cachedAt: Date.now() }));
  } catch { /* storage quota — non-fatal */ }
}

export function clearClustersCache(source?: FeedSource): void {
  const sources: FeedSource[] = source ? [source] : ["home", "timeline", "trending"];
  for (const s of sources) {
    try { localStorage.removeItem(cacheKey(s)); } catch { /* ignore */ }
  }
}

export async function fetchClusters(source: FeedSource = "timeline"): Promise<ClustersResponse> {
  const cached = readCache(source);
  if (cached) return cached;

  const res = await fetch(
    `/api/mastodon/clusters?source=${encodeURIComponent(source)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Clusters request failed (${res.status})`);
  }
  const data = (await res.json()) as ClustersResponse;
  writeCache(source, data);
  return data;
}

/** Clears the local cache and forces a fresh cluster on next fetch. */
export async function refreshClusters(source?: FeedSource): Promise<void> {
  clearClustersCache(source);
}
