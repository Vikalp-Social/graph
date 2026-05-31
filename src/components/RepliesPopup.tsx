import { useEffect, useMemo, useState } from "react";
import { getLocalStatus, getStatusContext, type Post } from "../api/mastodon";
import { formatPostAge } from "../canvas/timeAgo";
import type { PostRect } from "../layout/clusterLayout";

export function RepliesPopup({ post, onClose }: { post: PostRect; onClose: () => void }) {
  const [resolved, setResolved] = useState<{ id: string } | null>(null);
  const [descendants, setDescendants] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setResolved(null);
    setDescendants([]);

    (async () => {
      try {
        const local = await getLocalStatus({ id: post.id, url: post.url });
        if (!alive) return;
        setResolved(local);
        const ctx = await getStatusContext(local.id);
        if (!alive) return;
        setDescendants(ctx.descendants);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [post.id, post.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const indented = useMemo(() => {
    if (!resolved) return [] as Array<{ s: Post; depth: number }>;
    const depthOf = new Map<string, number>();
    depthOf.set(resolved.id, 0);
    return descendants.map((s) => {
      const parentId = s.inReplyToId ?? resolved.id;
      const parentDepth = depthOf.get(parentId) ?? 0;
      const depth = Math.min(parentDepth + 1, 6);
      depthOf.set(s.id, depth);
      return { s, depth };
    });
  }, [resolved, descendants]);

  return (
    <div onClick={onClose} role="dialog" aria-label="Replies" style={{ position: "fixed", inset: 0, background: "rgba(8, 11, 16, 0.6)", backdropFilter: "blur(4px)", zIndex: 55, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: "100%", maxHeight: "90vh", background: "#11151c", border: `1px solid ${post.color}55`, borderRadius: 14, boxShadow: `0 24px 80px -20px ${post.color}66`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${post.color}33`, flex: "0 0 auto" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: post.color }} />
          <strong style={{ flex: 1, color: post.color, fontSize: 14 }}>
            Replies
            {resolved && descendants.length > 0 && (
              <span style={{ marginLeft: 8, color: "#7a849a", fontWeight: 400 }}>{descendants.length}</span>
            )}
          </strong>
          <button type="button" onClick={onClose} aria-label="Close" style={iconBtn}>×</button>
        </header>

        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(120, 140, 170, 0.18)", background: "rgba(255, 255, 255, 0.02)", color: "#e6edf3", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", flex: "0 0 auto" }}>
          {post.authorHandle && (
            <div style={{ color: "#7a849a", fontSize: 13, marginBottom: 4 }}>
              {post.authorName ? `${post.authorName} ` : ""}<span style={{ opacity: 0.85 }}>{post.authorHandle}</span>
            </div>
          )}
          {post.content.length > 600 ? post.content.slice(0, 600) + "…" : post.content}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 4px" }}>
          {loading && <div style={{ padding: 14, color: "#aab3c4", fontSize: 13 }}>Loading replies…</div>}
          {error && !loading && <div style={{ padding: 14, color: "#f8b4b4", fontSize: 13 }}>{error}</div>}
          {!loading && !error && indented.length === 0 && <div style={{ padding: 14, color: "#7a849a", fontSize: 13 }}>No replies yet.</div>}
          {indented.map(({ s, depth }) => <ReplyRow key={s.id} post={s} depth={depth} />)}
        </div>
      </div>
    </div>
  );
}

function ReplyRow({ post, depth }: { post: Post; depth: number }) {
  const age = formatPostAge(post.createdAt);
  const indent = depth * 18;

  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 12px", marginLeft: indent, borderLeft: depth > 0 ? "1px solid rgba(120, 140, 170, 0.22)" : "none", borderBottom: "1px solid rgba(120, 140, 170, 0.10)" }}>
      {post.authorAvatar ? (
        <img src={post.authorAvatar} alt="" width={32} height={32} style={{ borderRadius: "50%", flex: "0 0 auto", objectFit: "cover" }} />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#2a3142", flex: "0 0 auto" }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, color: "#aab3c4", fontSize: 12, marginBottom: 2 }}>
          <strong style={{ color: "#e6edf3", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
            {post.authorName}
          </strong>
          <span style={{ opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
            {post.authorHandle}
          </span>
          {age && <span style={{ opacity: 0.55 }}>· {age}</span>}
        </div>
        <div style={{ color: "#dde3ee", fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {post.content}
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 14, color: "#7a849a", fontSize: 12 }}>
          <span>♡ {post.likes}</span>
          <span>⟲ {post.reposts}</span>
          {post.url && (
            <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ color: "#7aa2f7", textDecoration: "none" }}>Open ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "#aab3c4",
  fontSize: 22, lineHeight: 1, cursor: "pointer", padding: "4px 8px",
};
