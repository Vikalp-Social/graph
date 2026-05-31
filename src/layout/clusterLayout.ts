import { countWrappedLines, defaultStyle } from "../canvas/richText";
import type { TopicCluster } from "../types/clusters";

/** Post card size (Mastodon-like). Height is variable per post (see estimateCardHeight). */
export const CARD_W = 380;
export const CARD_H_MIN = 220;
export const CARD_H_MAX = 1200;
/** Default height used when something needs an at-rest card height (e.g. fit-view). */
export const CARD_H = CARD_H_MIN;
const CARD_GAP = 18;

// World-unit constants used both for card-height estimation here and for
// drawing in drawPostCard. Keep them in sync.
export const CARD_HEADER_H = 66;
export const CARD_FOOTER_H = 56;
export const CARD_BODY_LINE_H = 22;
export const CARD_BODY_TOP_PAD = 8;
export const CARD_BODY_BOTTOM_PAD = 14;
export const CARD_BODY_FONT_PX = 16;
export const CARD_IMAGE_H = 180;
export const CARD_IMAGE_TOP_GAP = 8;
export const CARD_IMAGE_BOTTOM_GAP = 12;
/** Horizontal padding & rail width subtracted from CARD_W to get usable text width. */
export const CARD_TEXT_PAD = 14;
export const CARD_TEXT_RAIL = 6;
/** Usable text column width inside a card, in world units. */
export const CARD_TEXT_W = CARD_W - CARD_TEXT_PAD * 2 - CARD_TEXT_RAIL;

/**
 * Pick a card height tall enough to fit text (measured exactly with the
 * same wrap algorithm the renderer uses) plus an optional image.
 */
export function estimateCardHeight(content: string, hasImage: boolean): number {
  const style = defaultStyle(CARD_BODY_FONT_PX);
  const measured = content
    ? countWrappedLines(content, CARD_TEXT_W, style)
    : 0;
  const minLines = hasImage ? 1 : 2;
  const lines = Math.max(minLines, measured);
  const body = CARD_BODY_TOP_PAD + lines * CARD_BODY_LINE_H + CARD_BODY_BOTTOM_PAD;
  const image = hasImage
    ? CARD_IMAGE_TOP_GAP + CARD_IMAGE_H + CARD_IMAGE_BOTTOM_GAP
    : 0;
  return Math.max(
    CARD_H_MIN,
    Math.min(CARD_H_MAX, CARD_HEADER_H + image + body + CARD_FOOTER_H),
  );
}

/** Distinct hues for topic color-coding (and the bottom legend). */
export const TOPIC_PALETTE = [
  "#7aa2f7", // blue
  "#bb9af7", // purple
  "#9ece6a", // green
  "#e0af68", // gold
  "#f7768e", // red
  "#7dcfff", // cyan
  "#ff9e64", // orange
  "#73daca", // teal
  "#c0caf5", // pale blue
  "#f0c674", // amber
  "#a6e3a1", // mint
  "#cba6f7", // lilac
];

export function colorForCluster(idx: number): string {
  return TOPIC_PALETTE[idx % TOPIC_PALETTE.length];
}

export interface PostRect {
  id: string;
  clusterId: number;
  clusterLabel: string;
  color: string;
  content: string;
  url?: string;
  imageUrl?: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  createdAt?: string;
  likes?: number;
  reposts?: number;
  replies?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TopicMeta {
  clusterId: number;
  label: string;
  color: string;
  postCount: number;
}

export interface WorldLayout {
  topics: TopicMeta[];
  posts: PostRect[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Card size in world units, exposed so the view can frame to a single post. */
  cardW: number;
  cardH: number;
}

/**
 * Row lengths for a hexagonal / beehive outline (top → bottom).
 * The widest row sits in the middle; rows above and below taper symmetrically.
 *
 * Examples:
 *   n=7  -> [2,3,2]
 *   n=19 -> [3,4,5,4,3]
 *   n=37 -> [4,5,6,7,6,5,4]
 *
 * For values of n that don't fill a perfect hexagon, the bottom row is
 * truncated (still centered) so the outline stays beehive-ish.
 */
export function hexagonalRowSizes(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];

  // Smallest hexagon side `s` whose cell count `3s^2 - 3s + 1` covers `n`.
  let s = 1;
  while (3 * s * s - 3 * s + 1 < n) s++;

  const rowCount = 2 * s - 1;
  const rows: number[] = [];
  for (let i = 0; i < rowCount; i++) {
    const dist = Math.abs(i - (s - 1));
    rows.push(rowCount - dist); // s, s+1, ..., 2s-1, ..., s+1, s
  }

  // Trim from the last row (which stays centered) until we hit exactly n.
  let total = rows.reduce((a, b) => a + b, 0);
  while (total > n) {
    const last = rows.length - 1;
    if (rows[last] <= 1) {
      total -= rows[last];
      rows.pop();
      continue;
    }
    rows[last]--;
    total--;
  }
  return rows;
}

interface TopicBlock {
  clusterId: number;
  label: string;
  color: string;
  cards: PostRect[]; // x/y are RELATIVE to the block's own (0, 0) top-left
  width: number;
  height: number;
}

/**
 * Pack one topic's posts into a tight column-masonry block. The number of
 * inner columns scales with post count (~sqrt) so a 4-post topic is ~2 wide
 * and a 16-post topic is ~4 wide. Each card drops into the lowest column,
 * eliminating shelf gaps within the topic.
 */
function packTopicBlock(
  cluster: TopicCluster,
  color: string,
): TopicBlock | null {
  const n = cluster.posts.length;
  if (n === 0) return null;

  // Inner column count: between 1 and 5, scaled by sqrt(n). Topics with a
  // single post are 1 col wide; bigger topics get up to 5 cols so they don't
  // form awkward tall stripes.
  const k = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(n * 0.7))));
  const colStep = CARD_W + CARD_GAP;
  const colY = new Array<number>(k).fill(0);
  const cards: PostRect[] = [];

  for (const p of cluster.posts) {
    const ph = estimateCardHeight(p.content, !!p.imageUrl);
    let bestCol = 0;
    for (let c = 1; c < k; c++) {
      if (colY[c] < colY[bestCol]) bestCol = c;
    }
    cards.push({
      id: p.id,
      clusterId: cluster.clusterId,
      clusterLabel: cluster.label,
      color,
      content: p.content,
      url: p.url,
      imageUrl: p.imageUrl,
      authorName: p.authorName,
      authorHandle: p.authorHandle,
      authorAvatar: p.authorAvatar,
      createdAt: p.createdAt,
      likes: p.likes,
      reposts: p.reposts,
      replies: p.replies,
      x: bestCol * colStep,
      y: colY[bestCol],
      w: CARD_W,
      h: ph,
    });
    colY[bestCol] += ph + CARD_GAP;
  }

  const width = k * CARD_W + (k - 1) * CARD_GAP;
  const height = Math.max(...colY) - CARD_GAP;
  return {
    clusterId: cluster.clusterId,
    label: cluster.label,
    color,
    cards,
    width,
    height,
  };
}

/**
 * Two-tier layout:
 *   1. Each topic is packed internally as its own column-masonry block, so
 *      same-topic posts sit tightly against each other with no gaps.
 *   2. Topic blocks are then arranged via shelf packing (largest-height
 *      first), with a small inter-block gap so different topics read as
 *      distinct neighbourhoods. Some shelves end up with leftover space below
 *      shorter blocks — that's the "organic" breathing room between topics.
 */
export function buildWorldLayout(clusters: TopicCluster[]): WorldLayout | null {
  if (!clusters.length) return null;

  const sorted = [...clusters].sort((a, b) => b.postCount - a.postCount);
  const topics: TopicMeta[] = sorted.map((c, i) => ({
    clusterId: c.clusterId,
    label: c.label,
    color: colorForCluster(i),
    postCount: c.postCount,
  }));

  const blocks: TopicBlock[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const blk = packTopicBlock(sorted[i], colorForCluster(i));
    if (blk) blocks.push(blk);
  }

  if (blocks.length === 0) {
    return {
      topics,
      posts: [],
      bounds: { minX: -400, minY: -400, maxX: 400, maxY: 400 },
      cardW: CARD_W,
      cardH: CARD_H,
    };
  }

  // Tall blocks first → they anchor each shelf; shorter blocks then squeeze in
  // beside them, minimizing wasted vertical space per shelf.
  const ordered = [...blocks].sort((a, b) => b.height - a.height);
  const totalArea = ordered.reduce((s, b) => s + b.width * b.height, 0);
  const maxBlockW = ordered.reduce((m, b) => Math.max(m, b.width), 0);
  // Aim for a roughly-square overall outline (slightly wider than tall feels
  // calmer on widescreens). targetW also has to fit the widest single block.
  const targetW = Math.max(maxBlockW, Math.sqrt(totalArea * 1.5));
  // ~3× the within-card gap → just enough breathing room to read as separate
  // groups without flying apart.
  const BLOCK_GAP = 56;

  interface Shelf {
    y: number;
    h: number;
    cursorX: number; // next-available x within this shelf
  }
  const shelves: Shelf[] = [{ y: 0, h: 0, cursorX: 0 }];
  const placements: Array<{ block: TopicBlock; ox: number; oy: number }> = [];

  for (const b of ordered) {
    let cur = shelves[shelves.length - 1];
    const needGap = cur.cursorX > 0 ? BLOCK_GAP : 0;
    if (cur.cursorX + needGap + b.width > targetW && cur.cursorX > 0) {
      shelves.push({
        y: cur.y + cur.h + BLOCK_GAP,
        h: 0,
        cursorX: 0,
      });
      cur = shelves[shelves.length - 1];
    }
    const ox = cur.cursorX + (cur.cursorX > 0 ? BLOCK_GAP : 0);
    placements.push({ block: b, ox, oy: cur.y });
    cur.cursorX = ox + b.width;
    if (b.height > cur.h) cur.h = b.height;
  }

  // Centre the meta-layout around (0, 0).
  let bMinX = Infinity;
  let bMinY = Infinity;
  let bMaxX = -Infinity;
  let bMaxY = -Infinity;
  for (const pl of placements) {
    if (pl.ox < bMinX) bMinX = pl.ox;
    if (pl.oy < bMinY) bMinY = pl.oy;
    if (pl.ox + pl.block.width > bMaxX) bMaxX = pl.ox + pl.block.width;
    if (pl.oy + pl.block.height > bMaxY) bMaxY = pl.oy + pl.block.height;
  }
  const cx = (bMinX + bMaxX) / 2;
  const cy = (bMinY + bMaxY) / 2;

  const posts: PostRect[] = [];
  for (const pl of placements) {
    for (const c of pl.block.cards) {
      posts.push({ ...c, x: pl.ox + c.x - cx, y: pl.oy + c.y - cy });
    }
  }

  const pad = 140;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of posts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.w > maxX) maxX = p.x + p.w;
    if (p.y + p.h > maxY) maxY = p.y + p.h;
  }

  return {
    topics,
    posts,
    bounds: {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
    },
    cardW: CARD_W,
    cardH: CARD_H,
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box (in world coords) of the "Open" button on a post card, or null. */
export function getOpenButtonRect(p: PostRect): Rect | null {
  if (!p.url) return null;
  const bw = 76;
  const bh = 30;
  const margin = 14;
  return {
    x: p.x + p.w - bw - margin,
    y: p.y + p.h - bh - margin,
    w: bw,
    h: bh,
  };
}

export interface CardActionRects {
  reply: Rect;
  thread: Rect;
  boost: Rect;
  like: Rect;
  open: Rect | null;
}

/**
 * Per-card action button rects in world coordinates. Four "interactive"
 * pills (reply / thread / boost / like) are stacked left-to-right in the
 * footer; "Open" sits on the right (when the post has a URL).
 *
 * `interactive=false` (e.g. signed-out viewers) just skips
 * reply/thread/boost/like — the function still returns rects so hit-testing
 * can decide to ignore them.
 */
export function getCardActionRects(p: PostRect): CardActionRects {
  const bh = 30;
  const margin = 14;
  const gap = 8;
  // Pill width is shrunk from 64→58 so a fourth button fits without
  // overlapping the right-side "Open ↗" link on the 380px-wide cards.
  const bw = 58;
  const y = p.y + p.h - bh - margin;
  const baseX = p.x + margin;
  return {
    reply: { x: baseX, y, w: bw, h: bh },
    thread: { x: baseX + (bw + gap), y, w: bw, h: bh },
    boost: { x: baseX + (bw + gap) * 2, y, w: bw, h: bh },
    like: { x: baseX + (bw + gap) * 3, y, w: bw, h: bh },
    open: getOpenButtonRect(p),
  };
}

export type CardActionKind =
  | "reply"
  | "thread"
  | "boost"
  | "like"
  | "open"
  | "image";

/**
 * World-coords bounding box of the post's image (or null if the post has
 * no attached image). Mirrors the image placement in drawPostCard.
 */
export function getCardImageRect(p: PostRect): Rect | null {
  if (!p.imageUrl) return null;
  return {
    x: p.x + CARD_TEXT_PAD + CARD_TEXT_RAIL,
    y: p.y + CARD_HEADER_H + CARD_IMAGE_TOP_GAP,
    w: p.w - CARD_TEXT_PAD * 2 - CARD_TEXT_RAIL,
    h: CARD_IMAGE_H,
  };
}

export function hitCardAction(
  p: PostRect,
  wx: number,
  wy: number,
  interactive: boolean,
): CardActionKind | null {
  const r = getCardActionRects(p);
  const inside = (b: Rect | null) =>
    !!b && wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
  if (inside(r.open)) return "open";
  // Image taps are public — allowed even when not signed in — and tested
  // before the action pills (image rects don't overlap them anyway).
  const img = getCardImageRect(p);
  if (inside(img)) return "image";
  if (!interactive) return null;
  if (inside(r.reply)) return "reply";
  if (inside(r.thread)) return "thread";
  if (inside(r.boost)) return "boost";
  if (inside(r.like)) return "like";
  return null;
}
