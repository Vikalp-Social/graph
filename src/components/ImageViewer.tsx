import { useEffect, useState } from "react";

/**
 * Full-bleed lightbox for a post image. Click/tap the backdrop or press
 * Escape to close. The image scales to fit while preserving aspect ratio
 * and never exceeds the viewport.
 */
export function ImageViewer({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt?: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label="Image viewer"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6, 8, 12, 0.88)",
        backdropFilter: "blur(6px)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        cursor: "zoom-out",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close image"
        style={{
          position: "absolute",
          top: 12,
          right: 14,
          background: "rgba(20, 26, 34, 0.85)",
          color: "#e6edf3",
          border: "1px solid rgba(120, 140, 170, 0.4)",
          borderRadius: 999,
          width: 36,
          height: 36,
          fontSize: 20,
          lineHeight: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ×
      </button>

      {!loaded && !errored && (
        <div style={{ color: "#aab3c4", fontSize: 14 }}>Loading image…</div>
      )}
      {errored && (
        <div style={{ color: "#f8b4b4", fontSize: 14 }}>
          Couldn’t load this image.
        </div>
      )}

      <img
        src={url}
        alt={alt ?? ""}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        // Stop the backdrop click from firing when tapping the image itself,
        // so users can examine details without dismissing the viewer.
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 6,
          boxShadow: "0 24px 80px -20px rgba(0,0,0,0.7)",
          display: loaded && !errored ? "block" : "none",
          cursor: "default",
        }}
      />
    </div>
  );
}
