import { useState, type FormEvent } from "react";
import { startLogin } from "../api/mastodonAuth";
import { SupportLink } from "./SupportLink";

export function LoginPanel({ onClose }: { onClose: () => void }) {
  const [instance, setInstance] = useState("mastodon.social");
  const [busy, setBusy] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    startLogin(instance);
    // Browser is now navigating to the instance OAuth page.
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "#16191e",
          border: "1px solid rgba(90,120,160,0.5)",
          borderRadius: 12,
          padding: 22,
          width: 380,
          maxWidth: "calc(100vw - 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          color: "#e6edf3",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18 }}>Sign in with Mastodon</h3>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.8, lineHeight: 1.45 }}>
          Enter your home instance. We'll redirect you there to authorize, then
          come back signed in.
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Instance</span>
          <input
            value={instance}
            onChange={(e) => setInstance(e.target.value)}
            placeholder="mastodon.social"
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            style={{
              padding: "9px 11px",
              borderRadius: 8,
              background: "#1a222c",
              border: "1px solid rgba(90,120,160,0.5)",
              color: "#e6edf3",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "transparent",
              color: "#aab3c4",
              border: "1px solid rgba(90,120,160,0.4)",
              cursor: busy ? "default" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !instance.trim()}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              background: "#7aa2f7",
              color: "#0b0f17",
              border: "none",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Connecting…" : "Continue"}
          </button>
        </div>
        <div style={{ borderTop: "1px solid rgba(90,120,160,0.25)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.7, textAlign: "center" }}>Enjoying Vikalp?</span>
          <SupportLink variant="login" />
        </div>
      </form>
    </div>
  );
}
