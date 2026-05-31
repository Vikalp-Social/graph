/**
 * Rich-text wrapping shared by the layout estimator and the renderer.
 *
 * `wrapRichText` produces the exact set of line segments that
 * `drawRichText` will paint, so the layout can size each card to fit
 * its content with no truncation and no overflow (URLs included).
 */

export interface RichTextStyle {
  fontPx: number;
  bodyFont: string;
  accentFont: string;
}

export interface RichSeg {
  text: string;
  acc: boolean;
}

export type RichLine = RichSeg[];

const TOKEN_RE = /(@[\w.-]+|#[\w]+|https?:\/\/[^\s]+)/g;

export function defaultStyle(fontPx: number): RichTextStyle {
  return {
    fontPx,
    bodyFont: `${fontPx}px system-ui, -apple-system, sans-serif`,
    accentFont: `600 ${fontPx}px system-ui, -apple-system, sans-serif`,
  };
}

function segmentRich(raw: string): RichSeg[] {
  const out: RichSeg[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(raw)) !== null) {
    if (m.index > last) out.push({ text: raw.slice(last, m.index), acc: false });
    out.push({ text: m[0], acc: true });
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push({ text: raw.slice(last), acc: false });
  return out;
}

function atomicTokens(segs: RichSeg[]): RichSeg[] {
  const out: RichSeg[] = [];
  for (const s of segs) {
    if (s.acc) {
      out.push(s);
      continue;
    }
    for (const p of s.text.split(/(\s+)/)) {
      if (p) out.push({ text: p, acc: false });
    }
  }
  return out;
}

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (measureCtx) return measureCtx;
  if (typeof OffscreenCanvas !== "undefined") {
    const oc = new OffscreenCanvas(1, 1);
    measureCtx = oc.getContext("2d") as unknown as CanvasRenderingContext2D;
  } else {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d")!;
  }
  return measureCtx;
}

/**
 * Wrap rich text to fit within `maxW`. Returns one RichLine per visual line.
 *
 * - Splits on whitespace, keeps URLs / @mentions / #hashtags as single
 *   "accent" tokens until they would overflow, at which point they're
 *   broken character-by-character (so long URLs never spill out of the
 *   card).
 * - Uses the provided `ctx` for measuring, or an offscreen canvas
 *   when called outside a paint cycle (height estimation).
 */
export function wrapRichText(
  raw: string,
  maxW: number,
  style: RichTextStyle,
  ctx?: CanvasRenderingContext2D,
): RichLine[] {
  const mctx = ctx ?? getMeasureCtx();
  const toks = atomicTokens(segmentRich(raw.replace(/\s+/g, " ").trim()));

  const lines: RichLine[] = [];
  let line: RichLine = [];
  let lineW = 0;

  const measure = (s: RichSeg): number => {
    mctx.font = s.acc ? style.accentFont : style.bodyFont;
    return mctx.measureText(s.text).width;
  };

  const pushLine = () => {
    lines.push(line);
    line = [];
    lineW = 0;
  };

  const breakLongToken = (seg: RichSeg) => {
    mctx.font = seg.acc ? style.accentFont : style.bodyFont;
    let chunk = "";
    for (let i = 0; i < seg.text.length; i++) {
      const next = chunk + seg.text[i];
      const w = mctx.measureText(next).width;
      if (w + lineW > maxW && chunk) {
        line.push({ text: chunk, acc: seg.acc });
        pushLine();
        chunk = seg.text[i];
      } else {
        chunk = next;
      }
    }
    if (chunk) {
      const w = mctx.measureText(chunk).width;
      line.push({ text: chunk, acc: seg.acc });
      lineW += w;
    }
  };

  for (const seg of toks) {
    const tw = measure(seg);

    if (tw > maxW) {
      // Token by itself is wider than the column → must be character-broken.
      // Flush the in-progress line first so the break starts fresh.
      if (lineW > 0) pushLine();
      // Don't keep leading whitespace at the start of a wrapped line.
      if (/^\s+$/.test(seg.text)) continue;
      breakLongToken(seg);
      continue;
    }

    if (lineW + tw > maxW && lineW > 0) {
      pushLine();
      // Don't carry a pure-whitespace token to the start of the next line.
      if (/^\s+$/.test(seg.text)) continue;
    }
    line.push(seg);
    lineW += tw;
  }

  if (line.length) lines.push(line);
  return lines;
}

/**
 * Estimate just the line count for a body (height-only, no allocation of
 * Line arrays beyond what `wrapRichText` already builds).
 */
export function countWrappedLines(
  raw: string,
  maxW: number,
  style: RichTextStyle,
): number {
  if (!raw) return 0;
  return wrapRichText(raw, maxW, style).length;
}

/**
 * Render the result of `wrapRichText` onto a canvas. The caller is
 * responsible for clipping / max-line cutoff.
 */
export function drawRichLines(
  ctx: CanvasRenderingContext2D,
  lines: RichLine[],
  x: number,
  y: number,
  lineHeight: number,
  style: RichTextStyle,
  bodyColor: string,
  accentColor: string,
  maxLines: number,
): void {
  const limit = Math.min(lines.length, maxLines);
  let cy = y;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < limit; i++) {
    let cx = x;
    for (const s of lines[i]) {
      ctx.font = s.acc ? style.accentFont : style.bodyFont;
      ctx.fillStyle = s.acc ? accentColor : bodyColor;
      ctx.fillText(s.text, cx, cy);
      cx += ctx.measureText(s.text).width;
    }
    cy += lineHeight;
  }
}
