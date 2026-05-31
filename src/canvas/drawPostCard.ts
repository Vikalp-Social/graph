import {
  CARD_BODY_FONT_PX,
  CARD_BODY_LINE_H,
  CARD_BODY_TOP_PAD,
  CARD_FOOTER_H,
  CARD_HEADER_H,
  CARD_IMAGE_BOTTOM_GAP,
  CARD_IMAGE_H,
  CARD_IMAGE_TOP_GAP,
  getCardActionRects,
  type PostRect,
  type Rect,
} from "../layout/clusterLayout";
import { defaultStyle, drawRichLines, wrapRichText } from "./richText";
import { formatPostAge } from "./timeAgo";

const COL = {
  bg: "#16191e",
  bgFlat: "#1c2230",
  border: "rgba(72, 82, 104, 0.85)",
  name: "#f2f5fa",
  handle: "#8b95a8",
  body: "#e8ecf2",
  accent: "#7aa2f7",
  footerIcon: "#9aa3b6",
  footerMuted: "#5c6578",
  buttonText: "#0b0f17",
  imagePlaceholder: "#222a38",
  imageBg: "#1f2632",
  // Action button states
  actionBg: "rgba(120, 140, 170, 0.10)",
  actionBorder: "rgba(120, 140, 170, 0.32)",
  actionText: "#c8d0e0",
  likeActive: "#f7768e",
  boostActive: "#9ece6a",
  replyActive: "#7aa2f7",
  threadActive: "#bb9af7",
};

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
  } else {
    ctx.rect(x, y, w, h);
  }
}

function initials(name?: string, handle?: string): string {
  const s = (name || handle || "?").trim();
  const parts = s.replace(/^@/, "").split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return s.slice(0, 2).toUpperCase() || "?";
}

export interface ImageCache {
  get(url: string | undefined): CanvasImageSource | undefined;
}

/**
 * Per-post interaction state, pulled from the App-level overlay map. When a
 * post hasn't been touched yet, defaults flow from the post's own counters.
 */
export interface PostActionState {
  liked: boolean;
  boosted: boolean;
  likes: number;
  reposts: number;
  pending: "like" | "boost" | null;
}

function drawActionButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  icon: string,
  label: string,
  active: boolean,
  activeColor: string,
  pending: boolean,
): void {
  const fill = active ? `${activeColor}22` : COL.actionBg;
  const border = active ? `${activeColor}cc` : COL.actionBorder;
  const fg = active ? activeColor : COL.actionText;

  drawRoundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = pending ? 0.55 : 1;
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `15px system-ui, sans-serif`;
  // Two-column inside the pill: icon on the left, count on the right.
  const cy = r.y + r.h / 2 + 1;
  ctx.fillText(icon, r.x + r.w * 0.32, cy);
  ctx.font = `600 12px system-ui, -apple-system, sans-serif`;
  ctx.fillText(label, r.x + r.w * 0.66, cy);
  ctx.restore();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  // `naturalWidth/Height` is on HTMLImageElement. Other sources fall back to dw/dh.
  const sw =
    (img as HTMLImageElement).naturalWidth ||
    (img as HTMLCanvasElement).width ||
    dw;
  const sh =
    (img as HTMLImageElement).naturalHeight ||
    (img as HTMLCanvasElement).height ||
    dh;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  const cx = dx + (dw - w) / 2;
  const cy = dy + (dh - h) / 2;
  ctx.drawImage(img, cx, cy, w, h);
}

/**
 * Draw a Mastodon-style post card in WORLD coordinates. The card is tinted
 * with the post's topic color (left rail + button) so identical-topic cards
 * are visually grouped even at low zoom. Card height is variable — taller
 * cards have more text or an attached image.
 *
 * `screenScale` is `view.scale` (zoom factor) — used only for level-of-detail
 * switching.
 */
export function drawPostCard(
  ctx: CanvasRenderingContext2D,
  p: PostRect,
  screenScale: number,
  images: ImageCache,
  state: PostActionState | null = null,
  interactive: boolean = false,
): void {
  const { x, y, w, h, color } = p;
  const screenW = w * screenScale;
  const hasImage = !!p.imageUrl;

  const liked = state?.liked ?? false;
  const boosted = state?.boosted ?? false;
  const likes = state?.likes ?? p.likes ?? 0;
  const reposts = state?.reposts ?? p.reposts ?? 0;
  const replies = p.replies ?? 0;
  const pending = state?.pending ?? null;

  if (screenW < 28) {
    // Far-away LOD: solid topic-colored block. Pattern recognition at a glance.
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    return;
  }

  const r = 12;
  const pad = 14;
  const rail = 6;

  if (screenW < 90) {
    drawRoundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = COL.bgFlat;
    ctx.fill();
    drawRoundRect(ctx, x, y, rail, h, r);
    ctx.fillStyle = color;
    ctx.fill();

    const aR = 26;
    const ax = x + pad + rail + aR;
    const ay = y + pad + aR;
    ctx.beginPath();
    ctx.arc(ax, ay, aR, 0, Math.PI * 2);
    const av = images.get(p.authorAvatar);
    if (av) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(av, ax - aR, ay - aR, aR * 2, aR * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = "#3d4558";
      ctx.fill();
    }

    const tx = x + pad + rail;
    const tw = w - pad * 2 - rail;
    let cy = ay + aR + 14;
    if (hasImage) {
      // Skeleton banner for the image so its presence is visible at this LOD.
      const bandH = Math.min(96, h * 0.4);
      ctx.fillStyle = COL.imagePlaceholder;
      ctx.fillRect(tx, cy, tw, bandH);
      const im = images.get(p.imageUrl);
      if (im) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(tx, cy, tw, bandH);
        ctx.clip();
        drawCoverImage(ctx, im, tx, cy, tw, bandH);
        ctx.restore();
      }
      cy += bandH + 10;
    }
    ctx.fillStyle = COL.handle;
    ctx.fillRect(tx, cy, tw, 8);
    ctx.fillRect(tx, cy + 16, tw - 60, 8);
    ctx.fillRect(tx, cy + 32, tw - 30, 8);
    return;
  }

  const avatarR = 22;
  const headerH = CARD_HEADER_H;
  const footerH = CARD_FOOTER_H;

  ctx.save();
  drawRoundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = COL.bg;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.stroke();

  // Left color rail tying the card to its topic.
  ctx.save();
  drawRoundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, rail, h);
  ctx.restore();

  const ax = x + pad + rail + avatarR;
  const ay = y + pad + avatarR;

  const av = images.get(p.authorAvatar);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, avatarR, 0, Math.PI * 2);
  ctx.clip();
  if (av) {
    ctx.drawImage(av, ax - avatarR, ay - avatarR, avatarR * 2, avatarR * 2);
  } else {
    ctx.fillStyle = "#3d4558";
    ctx.fillRect(ax - avatarR, ay - avatarR, avatarR * 2, avatarR * 2);
    ctx.fillStyle = "#c8d0e0";
    ctx.font = `15px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(p.authorName, p.authorHandle), ax, ay);
  }
  ctx.restore();

  const nameX = x + pad + rail + avatarR * 2 + 12;
  const nameY = y + pad + 4;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = COL.name;
  ctx.font = `600 17px system-ui, -apple-system, sans-serif`;
  ctx.fillText((p.authorName || "Unknown").slice(0, 40), nameX, nameY);

  ctx.fillStyle = COL.handle;
  ctx.font = `14px system-ui, sans-serif`;
  ctx.fillText((p.authorHandle || "").slice(0, 48), nameX, nameY + 22);

  const age = formatPostAge(p.createdAt);
  if (age) {
    ctx.fillStyle = COL.handle;
    ctx.textAlign = "right";
    ctx.fillText(age, x + w - pad, nameY + 4);
  }

  let bodyTop = y + headerH;

  if (hasImage) {
    const ix = x + pad + rail;
    const iw = w - pad * 2 - rail;
    const iy = bodyTop + CARD_IMAGE_TOP_GAP;
    const ih = CARD_IMAGE_H;
    ctx.save();
    drawRoundRect(ctx, ix, iy, iw, ih, 10);
    ctx.fillStyle = COL.imageBg;
    ctx.fill();
    ctx.clip();
    const im = images.get(p.imageUrl);
    if (im) {
      drawCoverImage(ctx, im, ix, iy, iw, ih);
    } else {
      ctx.fillStyle = COL.imagePlaceholder;
      ctx.fillRect(ix, iy, iw, ih);
    }
    ctx.restore();
    bodyTop = iy + ih + CARD_IMAGE_BOTTOM_GAP;
  } else {
    bodyTop += CARD_BODY_TOP_PAD - 2;
  }

  const bodyBottom = y + h - footerH - 8;
  const bodyH = Math.max(0, bodyBottom - bodyTop);
  const lh = CARD_BODY_LINE_H;
  const maxBodyLines = Math.max(1, Math.floor(bodyH / lh));

  const textW = w - pad * 2 - rail;
  const style = defaultStyle(CARD_BODY_FONT_PX);
  const lines = wrapRichText(p.content, textW, style, ctx);
  drawRichLines(
    ctx,
    lines,
    x + pad + rail,
    bodyTop,
    lh,
    style,
    COL.body,
    color,
    maxBodyLines,
  );

  // Footer actions: reply/boost/like as interactive pills (when signed in)
  // plus an "Open ↗" link to the post on its origin instance.
  const rects = getCardActionRects(p);
  const buttonsScreenH = rects.like.h * screenScale;
  // Skip the action pills entirely on tiny on-screen cards — they'd be
  // unreadable smudges that can't be tapped reliably anyway.
  const drawActions = interactive && buttonsScreenH >= 14;

  if (drawActions) {
    drawActionButton(
      ctx,
      rects.reply,
      "↩",
      "",
      false,
      COL.replyActive,
      false,
    );
    // "Thread" pill: opens a popup with the existing replies. Always
    // available (even signed-out) — Mastodon's /context endpoint is public.
    drawActionButton(
      ctx,
      rects.thread,
      "💬",
      String(replies),
      false,
      COL.threadActive,
      false,
    );
    drawActionButton(
      ctx,
      rects.boost,
      "⟲",
      String(reposts),
      boosted,
      COL.boostActive,
      pending === "boost",
    );
    drawActionButton(
      ctx,
      rects.like,
      liked ? "♥" : "♡",
      String(likes),
      liked,
      COL.likeActive,
      pending === "like",
    );
  } else {
    // Read-only footer for signed-out viewers / very small cards.
    const iconY = y + h - footerH + 22;
    let ix = x + pad + rail;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COL.footerIcon;
    ctx.font = `15px system-ui, sans-serif`;
    ctx.fillText("⟲", ix, iconY);
    ctx.fillStyle = COL.footerMuted;
    ctx.font = `13px system-ui, sans-serif`;
    ctx.fillText(String(reposts), ix + 18, iconY);
    ix += 56;
    ctx.fillStyle = COL.footerIcon;
    ctx.font = `15px system-ui, sans-serif`;
    ctx.fillText("♡", ix, iconY);
    ctx.fillStyle = COL.footerMuted;
    ctx.font = `13px system-ui, sans-serif`;
    ctx.fillText(String(likes), ix + 18, iconY);
  }

  const btn = rects.open;
  if (btn) {
    drawRoundRect(ctx, btn.x, btn.y, btn.w, btn.h, btn.h / 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = COL.buttonText;
    ctx.font = `700 13px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Open ↗", btn.x + btn.w / 2, btn.y + btn.h / 2 + 1);
  }

  ctx.restore();
}
