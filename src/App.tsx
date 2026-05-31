import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearClustersCache, fetchClusters, refreshClusters } from "./api/clusters";
import { favouriteStatus, getLocalStatus, reblogStatus } from "./api/mastodon";
import {
  AppSession,
  clearSession,
  fetchSession,
  handleCallbackIfPresent,
} from "./api/mastodonAuth";
import type { PostActionState } from "./canvas/drawPostCard";
import { ImageViewer } from "./components/ImageViewer";
import { LoginPanel } from "./components/LoginPanel";
import { RepliesPopup } from "./components/RepliesPopup";
import { ReplyPopup } from "./components/ReplyPopup";
import { SupportLink } from "./components/SupportLink";
import { TopicMapCanvas } from "./components/TopicMapCanvas";
import {
  buildWorldLayout,
  type CardActionKind,
  type PostRect,
  type TopicMeta,
} from "./layout/clusterLayout";
import type { ClustersResponse, FeedSource } from "./types/clusters";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
  );
  const [session, setSession] = useState<AppSession | null>(null);
  const [authBusy, setAuthBusy] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [source, setSource] = useState<FeedSource>("timeline");
  const [data, setData] = useState<ClustersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTopic, setActiveTopic] = useState<TopicMeta | null>(null);
  const [replyTo, setReplyTo] = useState<PostRect | null>(null);
  const [threadFor, setThreadFor] = useState<PostRect | null>(null);
  const [imageView, setImageView] = useState<{ url: string; alt?: string } | null>(null);
  const [actionState, setActionState] = useState<Record<string, PostActionState>>({});
  const resolvedCacheRef = useRef<Map<string, { id: string }>>(new Map());

  // On mount: check if returning from OAuth callback, otherwise load existing session.
  useEffect(() => {
    let alive = true;
    const init = async () => {
      try {
        const fromCallback = await handleCallbackIfPresent();
        if (!alive) return;
        if (fromCallback) {
          setSession(fromCallback);
          setSource("home");
        } else {
          const s = await fetchSession();
          if (!alive) return;
          setSession(s);
          if (s) setSource("home");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setAuthBusy(false);
      }
    };
    void init();
    return () => { alive = false; };
  }, []);

  // Collapse the chrome into the ☰ drawer below 640px, like 8bit. Close the
  // drawer automatically when returning to a wide viewport.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => {
      setNarrow(mq.matches);
      if (!mq.matches) setSidebarOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchClusters(source);
      setData(res);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    if (authBusy) return;
    if (!session) return;
    void load();
  }, [load, authBusy, session]);

  useEffect(() => {
    setActionState({});
    resolvedCacheRef.current.clear();
    setReplyTo(null);
    setThreadFor(null);
  }, [data]);

  useEffect(() => {
    if (!session) return;
    const send = () => {
      if (document.hidden) return;
      void fetch("/api/heartbeat", { method: "POST", credentials: "include" });
    };
    send();
    const id = setInterval(send, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [session]);

  const layout = useMemo(
    () => (data?.clusters?.length ? buildWorldLayout(data.clusters) : null),
    [data],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshClusters(source);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const onLogout = async () => {
    await clearSession();
    clearClustersCache();
    setSession(null);
    setReplyTo(null);
    setThreadFor(null);
    setActionState({});
    resolvedCacheRef.current.clear();
    if (source === "home") setSource("timeline");
  };

  const baseStateFor = useCallback(
    (post: PostRect): PostActionState => ({
      liked: false,
      boosted: false,
      likes: post.likes ?? 0,
      reposts: post.reposts ?? 0,
      pending: null,
    }),
    [],
  );

  const updateState = useCallback(
    (id: string, patch: Partial<PostActionState>, base: PostActionState) => {
      setActionState((cur) => ({
        ...cur,
        [id]: { ...(cur[id] ?? base), ...patch },
      }));
    },
    [],
  );

  const resolveStatus = useCallback(async (post: PostRect): Promise<{ id: string }> => {
    const cached = resolvedCacheRef.current.get(post.id);
    if (cached) return cached;
    const s = await getLocalStatus({ id: post.id, url: post.url });
    resolvedCacheRef.current.set(post.id, s);
    return s;
  }, []);

  const handleLike = useCallback(
    async (post: PostRect) => {
      const base = baseStateFor(post);
      const cur = actionState[post.id] ?? base;
      if (cur.pending) return;
      const willLike = !cur.liked;
      updateState(post.id, { liked: willLike, likes: Math.max(0, cur.likes + (willLike ? 1 : -1)), pending: "like" }, base);
      try {
        const local = await resolveStatus(post);
        const next = await favouriteStatus(local.id, willLike);
        setActionState((s) => {
          const c = s[post.id];
          if (!c) return s;
          return { ...s, [post.id]: { ...c, liked: willLike, likes: Math.max(c.likes, next.favourites_count), pending: null } };
        });
      } catch (e) {
        setActionState((s) => {
          const c = s[post.id];
          if (!c) return s;
          return { ...s, [post.id]: { ...c, liked: cur.liked, likes: cur.likes, pending: null } };
        });
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [actionState, baseStateFor, resolveStatus, updateState],
  );

  const handleBoost = useCallback(
    async (post: PostRect) => {
      const base = baseStateFor(post);
      const cur = actionState[post.id] ?? base;
      if (cur.pending) return;
      const willBoost = !cur.boosted;
      updateState(post.id, { boosted: willBoost, reposts: Math.max(0, cur.reposts + (willBoost ? 1 : -1)), pending: "boost" }, base);
      try {
        const local = await resolveStatus(post);
        const next = await reblogStatus(local.id, willBoost);
        setActionState((s) => {
          const c = s[post.id];
          if (!c) return s;
          return { ...s, [post.id]: { ...c, boosted: willBoost, reposts: Math.max(c.reposts, next.reblogs_count), pending: null } };
        });
      } catch (e) {
        setActionState((s) => {
          const c = s[post.id];
          if (!c) return s;
          return { ...s, [post.id]: { ...c, boosted: cur.boosted, reposts: cur.reposts, pending: null } };
        });
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [actionState, baseStateFor, resolveStatus, updateState],
  );

  const handlePostAction = useCallback(
    (post: PostRect, action: CardActionKind) => {
      if (action === "open") {
        if (post.url) window.open(post.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (action === "image") {
        if (post.imageUrl) setImageView({ url: post.imageUrl, alt: post.authorName || post.authorHandle });
        return;
      }
      if (!session) { setShowLogin(true); return; }
      if (action === "reply") { setReplyTo(post); return; }
      if (action === "thread") { setThreadFor(post); return; }
      if (action === "like") void handleLike(post);
      else if (action === "boost") void handleBoost(post);
    },
    [session, handleLike, handleBoost],
  );

  const getPostState = useCallback(
    (id: string): PostActionState | null => actionState[id] ?? null,
    [actionState],
  );

  if (authBusy || !session) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d1117" }}>
        {authBusy
          ? <span style={{ color: "#aab3c4", opacity: 0.6 }}>Loading…</span>
          : <LoginPanel onClose={() => {}} />
        }
      </div>
    );
  }

  // ─── Control render helpers (shared by desktop bar + mobile drawer) ──────────
  const SOURCES: FeedSource[] = ["timeline", "trending", "home"];
  const SOURCE_SHORT: Record<FeedSource, string> = { timeline: "public", trending: "trending", home: "home" };
  const SOURCE_FULL: Record<FeedSource, string> = { timeline: "Public timeline", trending: "Trending", home: "Home (signed in)" };

  const renderStats = (layout: "bar" | "drawer") => {
    if (!data || loading) return null;
    if (layout === "bar") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#9aa7b4", fontFamily: "ui-monospace, monospace", fontSize: 12, minWidth: 0 }}>
          <span style={{ whiteSpace: "nowrap" }}>{data.clusterCount} topics · {data.totalPosts} posts</span>
          <span title={data.source} style={{ color: "#7a8a9a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "min(220px, 22vw)" }}>· {data.source}</span>
        </div>
      );
    }
    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(90,120,160,0.15)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, color: "#7a8a9a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Stats</div>
        <div style={{ fontSize: 13, color: "#c0cdd8" }}>{data.clusterCount} topics</div>
        <div style={{ fontSize: 13, color: "#c0cdd8" }}>{data.totalPosts} posts</div>
        <div style={{ fontSize: 13, color: "#c0cdd8" }}>{data.source}</div>
      </div>
    );
  };

  const renderSourceButtons = (layout: "bar" | "drawer") => {
    if (layout === "bar") {
      return (
        <div style={{ display: "flex", border: "1px solid rgba(90,120,160,0.3)", borderRadius: 6, overflow: "hidden", flex: "0 0 auto" }}>
          {SOURCES.map((src) => (
            <button
              key={src}
              type="button"
              disabled={loading || refreshing}
              onClick={() => setSource(src)}
              title={SOURCE_FULL[src]}
              style={{
                border: "none", padding: "6px 10px", fontSize: 12, fontFamily: "ui-monospace, monospace",
                cursor: source === src ? "default" : "pointer",
                background: source === src ? "rgba(70,120,200,0.3)" : "transparent",
                color: source === src ? "#7ab4f5" : "#c0cdd8",
              }}
            >
              {SOURCE_SHORT[src]}
            </button>
          ))}
        </div>
      );
    }
    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(90,120,160,0.15)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11, color: "#7a8a9a", textTransform: "uppercase", letterSpacing: "0.08em" }}>Source</div>
        {SOURCES.map((src) => (
          <button
            key={src}
            type="button"
            disabled={loading || refreshing}
            onClick={() => { setSource(src); setSidebarOpen(false); }}
            style={{
              textAlign: "left", background: source === src ? "rgba(70,120,200,0.25)" : "transparent",
              color: source === src ? "#7ab4f5" : "#c0cdd8",
              border: `1px solid ${source === src ? "rgba(120,160,220,0.5)" : "rgba(90,120,160,0.2)"}`,
              borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontSize: 13,
            }}
          >
            {SOURCE_FULL[src]}
          </button>
        ))}
      </div>
    );
  };

  const renderRefresh = (layout: "bar" | "drawer") => {
    if (layout === "bar") {
      return (
        <button
          type="button"
          disabled={loading || refreshing}
          onClick={() => { void onRefresh(); }}
          style={{
            background: "rgba(70,120,200,0.3)", color: "#e6edf3", border: "1px solid rgba(120,160,220,0.5)",
            borderRadius: 6, padding: "7px 12px", fontSize: 13, fontFamily: "ui-monospace, monospace",
            cursor: loading || refreshing ? "wait" : "pointer", whiteSpace: "nowrap", flex: "0 0 auto",
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      );
    }
    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(90,120,160,0.15)" }}>
        <button
          type="button"
          disabled={loading || refreshing}
          onClick={() => { void onRefresh(); setSidebarOpen(false); }}
          style={{ width: "100%", background: "rgba(70,120,200,0.3)", color: "#e6edf3", border: "1px solid rgba(120,160,220,0.5)", borderRadius: 6, padding: "8px 12px", cursor: loading || refreshing ? "wait" : "pointer", fontSize: 13 }}
        >
          {refreshing ? "Refreshing…" : "Refresh clusters"}
        </button>
      </div>
    );
  };

  const renderUser = (layout: "bar" | "drawer") => {
    if (layout === "bar") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "0 1 auto" }}>
          {session.avatar && <img src={session.avatar} alt="" width={24} height={24} style={{ borderRadius: "50%", flex: "0 0 auto" }} />}
          <span
            title={`@${session.username}@${session.instance}`}
            style={{ fontSize: 12, color: "#9aa7b4", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "min(160px, 18vw)" }}
          >
            @{session.username}@{session.instance}
          </span>
          <button
            type="button"
            onClick={() => { void onLogout(); }}
            style={{ background: "transparent", color: "#f47e7e", border: "1px solid rgba(200,80,80,0.35)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", flex: "0 0 auto" }}
          >
            Sign out
          </button>
        </div>
      );
    }
    return (
      <div style={{ padding: "14px 16px", marginTop: "auto", borderTop: "1px solid rgba(90,120,160,0.15)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {session.avatar && <img src={session.avatar} alt="" width={32} height={32} style={{ borderRadius: "50%" }} />}
          <div style={{ fontSize: 13, color: "#c0cdd8", wordBreak: "break-all" }}>@{session.username}@{session.instance}</div>
        </div>
        <button
          type="button"
          onClick={() => { void onLogout(); setSidebarOpen(false); }}
          style={{ width: "100%", background: "transparent", color: "#f47e7e", border: "1px solid rgba(200,80,80,0.35)", borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontSize: 13 }}
        >
          Sign out
        </button>
      </div>
    );
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Top bar — full chrome inline on desktop; brand + ☰ drawer on mobile */}
      <header style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "8px 14px", borderBottom: "1px solid rgba(90, 120, 160, 0.35)",
        background: "rgba(18, 24, 32, 0.95)",
      }}>
        <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, letterSpacing: "0.02em", flex: "0 0 auto" }}>vikalp.social</strong>
        {!narrow ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            {loading && <span style={{ color: "#aab3c4", fontSize: 12, opacity: 0.7, flex: "0 0 auto" }}>Loading…</span>}
            {renderStats("bar")}
            {renderSourceButtons("bar")}
            {renderRefresh("bar")}
            <span style={{ flex: 1, minWidth: 8 }} />
            <SupportLink variant="bar" />
            {renderUser("bar")}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {loading && <span style={{ color: "#aab3c4", fontSize: 12, opacity: 0.7 }}>Loading…</span>}
            {session.avatar && (
              <img src={session.avatar} alt="" width={26} height={26} style={{ borderRadius: "50%", flex: "0 0 auto" }} />
            )}
            <button
              type="button"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Menu"
              style={{ background: "transparent", border: "1px solid rgba(90,120,160,0.4)", borderRadius: 6, color: "#e6edf3", width: 34, height: 34, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 0, flexShrink: 0 }}
            >
              <span style={{ display: "block", width: 16, height: 2, background: "#e6edf3", borderRadius: 1 }} />
              <span style={{ display: "block", width: 16, height: 2, background: "#e6edf3", borderRadius: 1 }} />
              <span style={{ display: "block", width: 16, height: 2, background: "#e6edf3", borderRadius: 1 }} />
            </button>
          </div>
        )}
      </header>

      {/* Sidebar drawer — mobile only */}
      {narrow && (
        <>
          {sidebarOpen && (
            <div
              onClick={() => setSidebarOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.45)" }}
            />
          )}
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 50,
            width: 260, background: "rgba(14, 20, 30, 0.98)",
            borderLeft: "1px solid rgba(90, 120, 160, 0.35)",
            display: "flex", flexDirection: "column", gap: 0,
            transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.22s ease",
            backdropFilter: "blur(8px)",
          }}>
            {/* Sidebar header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(90,120,160,0.2)" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13, color: "#a0b0d0" }}>Menu</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                style={{ background: "transparent", border: "none", color: "#aab3c4", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}
              >✕</button>
            </div>

            {renderStats("drawer")}
            {renderSourceButtons("drawer")}
            {renderRefresh("drawer")}

            {/* Support */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(90,120,160,0.15)" }}>
              <SupportLink variant="drawer" />
            </div>

            {renderUser("drawer")}
          </div>
        </>
      )}
      {error && (
        <div style={{ flex: "0 0 auto", padding: "10px 14px", background: "rgba(120, 40, 40, 0.25)", color: "#f8b4b4", fontSize: 14, whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <TopicMapCanvas
          layout={layout}
          loading={loading}
          interactive={!!session}
          getPostState={getPostState}
          onActiveTopicChange={setActiveTopic}
          onPostAction={handlePostAction}
        />
        {loading && (
          <div
            style={{
              position: "absolute", inset: 0, zIndex: 30,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 14, textAlign: "center", padding: 24, boxSizing: "border-box",
              background: "rgba(13, 17, 23, 0.82)", backdropFilter: "blur(2px)",
            }}
          >
            <div className="vg-spinner" />
            <div style={{ color: "#c0cdd8", fontFamily: "ui-monospace, monospace", fontSize: 15 }}>
              Clustering {source === "home" ? "your home feed" : source === "trending" ? "trending posts" : "the public timeline"}…
            </div>
            <div style={{ color: "#7a8a9a", fontSize: 12, maxWidth: 320 }}>
              Grouping posts into topics — this can take a moment.
            </div>
          </div>
        )}
        {activeTopic && (
          <div
            key={activeTopic.clusterId}
            className="vg-topic-chip"
            style={{
              position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
              borderRadius: 18, background: "rgba(14, 18, 24, 0.82)",
              border: `1px solid ${activeTopic.color}55`, boxShadow: `0 6px 30px -12px ${activeTopic.color}55`,
              backdropFilter: "blur(8px)", display: "flex", alignItems: "center",
              justifyContent: "center", flexWrap: "wrap", rowGap: 4, columnGap: 10,
              pointerEvents: "none", maxWidth: "calc(100vw - 24px)", boxSizing: "border-box",
              animation: "vg-topic-fade 220ms ease-out",
            }}
          >
            <span className="vg-topic-dot" style={{ borderRadius: "50%", background: activeTopic.color, boxShadow: `0 0 12px ${activeTopic.color}`, flex: "0 0 auto" }} />
            <span className="vg-topic-label" style={{ color: activeTopic.color, fontWeight: 700, letterSpacing: 0.3, lineHeight: 1.2, wordBreak: "break-word", textAlign: "center", minWidth: 0 }}>
              {activeTopic.label}
            </span>
            <span className="vg-topic-count" style={{ color: "#aab3c4", opacity: 0.85, flex: "0 0 auto" }}>
              {activeTopic.postCount} posts
            </span>
          </div>
        )}
        {replyTo && session && <ReplyPopup key={replyTo.id} post={replyTo} onClose={() => setReplyTo(null)} />}
        {threadFor && session && <RepliesPopup key={`thread-${threadFor.id}`} post={threadFor} onClose={() => setThreadFor(null)} />}
        {imageView && <ImageViewer url={imageView.url} alt={imageView.alt} onClose={() => setImageView(null)} />}
        {showLogin && <LoginPanel onClose={() => setShowLogin(false)} />}
        <style>{`
          @keyframes vg-topic-fade {
            from { opacity: 0; transform: translate(-50%, -6px); }
            to   { opacity: 1; transform: translate(-50%, 0); }
          }
          .vg-topic-chip { padding: 10px 22px; }
          .vg-topic-dot   { width: 12px; height: 12px; }
          .vg-topic-label { font-size: 22px; }
          .vg-topic-count { font-size: 13px; }
          @media (max-width: 640px) {
            .vg-topic-chip  { padding: 8px 14px; border-radius: 14px; }
            .vg-topic-dot   { width: 10px; height: 10px; }
            .vg-topic-label { font-size: 17px; }
            .vg-topic-count { font-size: 12px; flex-basis: 100%; text-align: center; }
          }
          @media (max-width: 380px) {
            .vg-topic-chip  { padding: 6px 12px; }
            .vg-topic-label { font-size: 15px; }
          }
          .vg-spinner {
            width: 44px; height: 44px; border-radius: 50%;
            border: 4px solid rgba(122,162,247,0.22);
            border-top-color: #7aa2f7;
            animation: vg-spin 0.8s linear infinite;
          }
          @keyframes vg-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}
