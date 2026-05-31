import type { CSSProperties } from "react";

/** Ko-fi donation page for vikalp.social. */
export const KOFI_URL = "https://ko-fi.com/vikalp_social";

type SupportVariant = "bar" | "drawer" | "login";

const BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  textDecoration: "none",
  fontFamily: "ui-monospace, monospace",
  // Match the refresh button so the donate CTA reads as part of the chrome.
  color: "#e6edf3",
  background: "rgba(70,120,200,0.3)",
  border: "1px solid rgba(120,160,220,0.5)",
  borderRadius: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const VARIANTS: Record<SupportVariant, CSSProperties> = {
  bar: { padding: "3px 16px", fontSize: 13, fontWeight: 700 },
  drawer: { padding: "8px 12px", fontSize: 13, width: "100%", boxSizing: "border-box" },
  login: { padding: "9px 12px", fontSize: 13, width: "100%", boxSizing: "border-box" },
};

/** External link to the Ko-fi donation page. Opens in a new tab safely. */
export function SupportLink({
  variant = "bar",
  label = "Support Vikalp",
}: {
  variant?: SupportVariant;
  label?: string;
}) {
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Support Vikalp on Ko-fi"
      style={{ ...BASE, ...VARIANTS[variant] }}
    >
      <span aria-hidden={true} style={{ fontSize: "2.2em", lineHeight: 1 }}>☕</span>
      {label}
    </a>
  );
}
