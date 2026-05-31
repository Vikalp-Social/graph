import { useEffect, useRef, useState } from "react";
import { getLocalStatus, postReply } from "../api/mastodon";
import type { PostRect } from "../layout/clusterLayout";

const MAX_CHARS = 500;

/**
 * Centered modal for posting a reply. Resolves the post to a local status
 * id on mount (remote posts need to be looked up by URL via search) and
 * disables the send button until that resolution finishes.
 */
export function ReplyPopup({
  post,
  onClose,
  onReplied,
}: {
  post: PostRect;
  onClose: () => void;
  onReplied?: (newReplyCount: number) => void;
}) {
  const [resolved, setResolved] = useState<{ id: string } | null>(null);
  const [resolving, setResolving] = useState(true);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    setResolving(true);
    setResolveError(null);
    getLocalStatus({ id: post.id, url: post.url })
      .then((s) => {
        if (alive) setResolved(s);
      })
      .catch((e) => {
        if (alive) setResolveError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setResolving(false);
      });
    return () => {
      alive = false;
    };
  }, [post.id, post.url]);

  useEffect(() => {
    // Defer focus until the textarea is mounted; the popup itself fades in
    // and stealing focus instantly feels jumpier than a one-frame delay.
    const id = window.setTimeout(() => taRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    if (!resolved || !text.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const reply = await postReply(resolved.id, text.trim());
      onReplied?.(0);
      void reply;
      onClose();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const previewText = post.content;
  const previewSnippet =
    previewText.length > 220 ? previewText.slice(0, 220) + "…" : previewText;

  const charsLeft = MAX_CHARS - text.length;
  const overLimit = charsLeft < 0;
  const canSend = !!resolved && !sending && text.trim().length > 0 && !overLimit;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 11, 16, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "100%",
          maxHeight: "90vh",
          background: "#11151c",
          border: `1px solid ${post.color}55`,
          borderRadius: 14,
          boxShadow: `0 24px 80px -20px ${post.color}66`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: `1px solid ${post.color}33`,
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: post.color,
            }}
          />
          <strong style={{ flex: 1, color: post.color, fontSize: 14 }}>
            Reply to {post.authorName || post.authorHandle || "post"}
          </strong>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={iconBtn}
          >
            ×
          </button>
        </header>

        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid rgba(120, 140, 170, 0.18)",
            background: "rgba(255, 255, 255, 0.02)",
            color: "#aab3c4",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            maxHeight: 160,
            overflowY: "auto",
            flex: "0 0 auto",
          }}
        >
          {post.authorHandle && (
            <div style={{ color: "#7a849a", marginBottom: 4 }}>
              {post.authorHandle}
            </div>
          )}
          {previewSnippet}
        </div>

        <div
          style={{
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: 1,
            minHeight: 0,
          }}
        >
          {resolving && (
            <div style={{ color: "#aab3c4", fontSize: 13 }}>
              Looking up post on your instance…
            </div>
          )}
          {resolveError && (
            <div style={{ color: "#f8b4b4", fontSize: 13 }}>{resolveError}</div>
          )}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your reply…"
            disabled={!resolved || sending}
            rows={5}
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              minHeight: 110,
              background: "#0d1119",
              color: "#e6edf3",
              border: "1px solid rgba(120, 140, 170, 0.32)",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          {sendError && (
            <div style={{ color: "#f8b4b4", fontSize: 13 }}>{sendError}</div>
          )}
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderTop: "1px solid rgba(120, 140, 170, 0.18)",
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: overLimit ? "#f7768e" : "#7a849a",
            }}
          >
            {charsLeft} chars
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            style={{
              ...primaryBtn,
              background: canSend ? post.color : "rgba(120, 140, 170, 0.25)",
              color: canSend ? "#0b0f17" : "#7a849a",
              cursor: canSend ? "pointer" : "not-allowed",
            }}
          >
            {sending ? "Sending…" : "Reply"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#aab3c4",
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
  padding: "4px 8px",
};

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  color: "#aab3c4",
  border: "1px solid rgba(120, 140, 170, 0.4)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 13,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 700,
};
