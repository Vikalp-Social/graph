import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { drawPostCard, type PostActionState } from "../canvas/drawPostCard";
import {
  hitCardAction,
  type CardActionKind,
  type PostRect,
  type TopicMeta,
  type WorldLayout,
} from "../layout/clusterLayout";

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
/** Straight-line displacement (px) below which a pointerup counts as a click. */
const CLICK_MOVE_PX = 10;
/** Hold-to-click time cap (ms). Anything longer is treated as a drag-then-release. */
const CLICK_MS = 800;
const SAMPLE_MS = 140;
const INERTIA_MIN_SPEED = 18;
const FRICTION_PER_MS = 0.0032;

interface View {
  panX: number;
  panY: number;
  scale: number;
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  posts: PostRect[],
  getAvatar: (url: string | undefined) => CanvasImageSource | undefined,
  getState: (id: string) => PostActionState | null,
  interactive: boolean,
): void {
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.scale, view.scale);

  const visMinX = (-view.panX) / view.scale;
  const visMinY = (-view.panY) / view.scale;
  const visMaxX = visMinX + w / view.scale;
  const visMaxY = visMinY + h / view.scale;

  ctx.strokeStyle = "rgba(100, 140, 180, 0.18)";
  ctx.lineWidth = 1.5;
  const grid = 280;
  for (let x = Math.floor(visMinX / grid) * grid; x <= visMaxX; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, visMinY);
    ctx.lineTo(x, visMaxY);
    ctx.stroke();
  }
  for (let y = Math.floor(visMinY / grid) * grid; y <= visMaxY; y += grid) {
    ctx.beginPath();
    ctx.moveTo(visMinX, y);
    ctx.lineTo(visMaxX, y);
    ctx.stroke();
  }

  const avatars = { get: getAvatar };
  for (const p of posts) {
    if (
      p.x + p.w < visMinX ||
      p.x > visMaxX ||
      p.y + p.h < visMinY ||
      p.y > visMaxY
    ) {
      continue;
    }
    drawPostCard(ctx, p, view.scale, avatars, getState(p.id), interactive);
  }

  ctx.restore();
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

function computeCenterTopic(
  view: View,
  w: number,
  h: number,
  layout: WorldLayout,
): TopicMeta | null {
  const cxWorld = (w / 2 - view.panX) / view.scale;
  const cyWorld = (h / 2 - view.panY) / view.scale;
  const visMinX = -view.panX / view.scale;
  const visMinY = -view.panY / view.scale;
  const visMaxX = visMinX + w / view.scale;
  const visMaxY = visMinY + h / view.scale;

  // Falloff radius (world units): roughly half the smaller viewport dimension.
  // Posts near the center contribute most; posts at the edges contribute ~0.
  const falloff = Math.max(1, (Math.min(w, h) / view.scale) * 0.5);

  const weights = new Map<number, number>();
  for (const p of layout.posts) {
    if (
      p.x + p.w < visMinX ||
      p.x > visMaxX ||
      p.y + p.h < visMinY ||
      p.y > visMaxY
    ) {
      continue;
    }
    const px = p.x + p.w / 2;
    const py = p.y + p.h / 2;
    const d = Math.hypot(px - cxWorld, py - cyWorld);
    const wgt = Math.max(0, 1 - d / falloff);
    if (wgt <= 0) continue;
    weights.set(p.clusterId, (weights.get(p.clusterId) ?? 0) + wgt);
  }

  let bestId: number | null = null;
  let bestW = 0;
  for (const [id, wgt] of weights) {
    if (wgt > bestW) {
      bestW = wgt;
      bestId = id;
    }
  }
  if (bestId === null) return null;
  return layout.topics.find((t) => t.clusterId === bestId) ?? null;
}

export function TopicMapCanvas({
  layout,
  loading = false,
  interactive = false,
  getPostState,
  onActiveTopicChange,
  onPostAction,
}: {
  layout: WorldLayout | null;
  loading?: boolean;
  /** Whether action pills (like/boost/reply) are rendered + hit-tested. */
  interactive?: boolean;
  getPostState?: (id: string) => PostActionState | null;
  onActiveTopicChange?: (topic: TopicMeta | null) => void;
  onPostAction?: (post: PostRect, action: CardActionKind) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<WorldLayout | null>(null);
  layoutRef.current = layout;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const viewRef = useRef<View>({ panX: 0, panY: 0, scale: 1 });
  const velRef = useRef({ vx: 0, vy: 0 });
  const rafRef = useRef<number>(0);
  const lastDrawRef = useRef(0);

  const pointerDownRef = useRef(false);
  const lastPtrRef = useRef({ x: 0, y: 0 });
  const downPtrRef = useRef({ x: 0, y: 0, t: 0 });
  const samplesRef = useRef<Sample[]>([]);
  const movedSqRef = useRef(0);
  // Active pointers (mouse + touches) keyed by pointerId for pinch + multi-touch.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Baseline distance/midpoint for the current pinch gesture.
  const pinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(
    null,
  );

  const [grabbing, setGrabbing] = useState(false);
  const avatarMapRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const avatarGenRef = useRef(0);
  const lastActiveTopicIdRef = useRef<number | null>(null);
  const onActiveTopicChangeRef = useRef(onActiveTopicChange);
  onActiveTopicChangeRef.current = onActiveTopicChange;
  const onPostActionRef = useRef(onPostAction);
  onPostActionRef.current = onPostAction;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const getPostStateRef = useRef(getPostState);
  getPostStateRef.current = getPostState;

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { w: 0, h: 0, dpr: 1 };
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    return { w, h, dpr };
  }, []);

  const fitViewToLayout = useCallback(() => {
    const canvas = canvasRef.current;
    const wl = layoutRef.current;
    if (!canvas || !wl || !wl.posts.length) return;

    const { w, h } = syncCanvasSize();
    if (w <= 0 || h <= 0) return;

    // Frame a chunk of cards around the top of the stack (the largest topic),
    // so users land on something readable instead of a tiny overview.
    const targetCols = Math.min(3, Math.max(1, Math.ceil(wl.posts.length / 4)));
    const targetRows = 2;
    const targetW = targetCols * wl.cardW + (targetCols - 1) * 18;
    const targetH = targetRows * wl.cardH + (targetRows - 1) * 18;
    const margin = 80;
    const scale = clampScale(
      Math.min((w - margin) / targetW, (h - margin) / targetH),
    );

    // Center on the topmost row of the stack so the user sees the largest topic first.
    const topPosts = wl.posts.slice(0, targetCols);
    const cx =
      topPosts.reduce((s, p) => s + p.x + p.w / 2, 0) / topPosts.length;
    const cy = topPosts[0].y + wl.cardH / 2;

    viewRef.current = {
      scale,
      panX: w / 2 - cx * scale,
      panY: h / 2 - cy * scale,
    };
    velRef.current = { vx: 0, vy: 0 };
  }, [syncCanvasSize]);

  useEffect(() => {
    if (layout && layout.posts.length > 0) {
      fitViewToLayout();
    }
    // Reset so the next draw re-emits the active topic for the new dataset.
    lastActiveTopicIdRef.current = null;
  }, [layout, fitViewToLayout]);

  const requestRedraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h, dpr } = syncCanvasSize();
    if (w <= 0 || h <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wl = layoutRef.current;
    if (!wl || wl.posts.length === 0) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(180, 200, 230, 0.55)";
      ctx.font = "15px system-ui, sans-serif";
      ctx.textAlign = "center";
      const msg = loadingRef.current
        ? "Loading clusters…"
        : "No clusters yet. Fix errors above or refresh when Topic-Cluster API is running.";
      ctx.fillText(msg, w / 2, h / 2);
      return;
    }

    const getAvatar = (url: string | undefined) =>
      url ? avatarMapRef.current.get(url) : undefined;
    const getState = (id: string) => getPostStateRef.current?.(id) ?? null;
    draw(
      ctx,
      w,
      h,
      viewRef.current,
      wl.posts,
      getAvatar,
      getState,
      interactiveRef.current,
    );

    // Notify the page when the topic dominating the viewport's center changes,
    // so an ambient title can be shown above the canvas.
    const topic = computeCenterTopic(viewRef.current, w, h, wl);
    const newId = topic?.clusterId ?? null;
    if (newId !== lastActiveTopicIdRef.current) {
      lastActiveTopicIdRef.current = newId;
      onActiveTopicChangeRef.current?.(topic);
    }
  }, [syncCanvasSize]);

  const stopInertia = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    velRef.current = { vx: 0, vy: 0 };
  }, []);

  const tickInertia = useCallback(
    (t: number) => {
      const last = lastDrawRef.current || t;
      const dt = Math.min(48, t - last);
      lastDrawRef.current = t;

      const v = velRef.current;
      const decay = Math.exp(-FRICTION_PER_MS * dt);
      v.vx *= decay;
      v.vy *= decay;

      const speed = Math.hypot(v.vx, v.vy);
      if (speed < 4) {
        v.vx = 0;
        v.vy = 0;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        requestRedraw();
        return;
      }

      viewRef.current.panX += v.vx * (dt / 1000);
      viewRef.current.panY += v.vy * (dt / 1000);
      requestRedraw();
      rafRef.current = requestAnimationFrame(tickInertia);
    },
    [requestRedraw],
  );

  const startInertiaIfNeeded = useCallback(() => {
    const now = performance.now();
    const samples = samplesRef.current;
    const recent = samples.filter((s) => now - s.t <= SAMPLE_MS);
    if (recent.length < 2) return;

    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = b.t - a.t;
    if (dt < 8) return;

    const vx = ((b.x - a.x) / dt) * 1000;
    const vy = ((b.y - a.y) / dt) * 1000;
    const sp = Math.hypot(vx, vy);
    if (sp < INERTIA_MIN_SPEED) return;

    const cap = 2200;
    const k = sp > cap ? cap / sp : 1;
    velRef.current = { vx: vx * k, vy: vy * k };
    lastDrawRef.current = performance.now();
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(tickInertia);
    }
  }, [tickInertia]);

  useEffect(() => {
    requestRedraw();
  }, [layout, loading, interactive, getPostState, requestRedraw]);

  useEffect(() => {
    if (!layout?.posts.length) return;
    const gen = ++avatarGenRef.current;
    const urls = new Set<string>();
    for (const p of layout.posts) {
      if (p.authorAvatar) urls.add(p.authorAvatar);
      if (p.imageUrl) urls.add(p.imageUrl);
    }
    for (const url of urls) {
      if (avatarMapRef.current.has(url)) continue;
      const img = new Image();
      // No crossOrigin: we only drawImage() (never read canvas pixels), and many
      // Mastodon / pixelfed / Flickr media hosts omit CORS headers — requesting CORS
      // makes those images fail to load. Tainting the canvas is harmless here.
      img.onload = () => {
        if (gen !== avatarGenRef.current) return;
        avatarMapRef.current.set(url, img);
        requestRedraw();
      };
      img.onerror = () => {
        avatarMapRef.current.delete(url);
      };
      img.src = url;
    }
  }, [layout, requestRedraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(() => {
      requestRedraw();
    });
    ro.observe(canvas);

    const onResize = () => requestRedraw();
    window.addEventListener("resize", onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      stopInertia();
    };
  }, [requestRedraw, stopInertia]);

  // Convert screen-space (sx, sy) into a click intent on a specific post's
  // action button. We don't return a "body click" any more — the per-card
  // action pills replaced the old side-panel selection flow.
  const hitTest = useCallback(
    (
      sx: number,
      sy: number,
    ): { post: PostRect; action: CardActionKind } | null => {
      const v = viewRef.current;
      const wx = (sx - v.panX) / v.scale;
      const wy = (sy - v.panY) / v.scale;
      const wl = layoutRef.current;
      if (!wl) return null;
      const posts = wl.posts;
      // Match drawPostCard: action pills are only rendered when their on-
      // screen height is large enough to be readable / tappable. Don't
      // hit-test buttons that aren't visible.
      const buttonScreenH = 30 * v.scale;
      const interactiveNow = !!interactiveRef.current && buttonScreenH >= 14;
      for (let i = posts.length - 1; i >= 0; i--) {
        const p = posts[i];
        if (
          wx < p.x ||
          wx > p.x + p.w ||
          wy < p.y ||
          wy > p.y + p.h
        ) {
          continue;
        }
        const action = hitCardAction(p, wx, wy, interactiveNow);
        if (action) return { post: p, action };
        // Click landed on the card chrome but not on a button — treat as
        // a no-op (so the user can pan from anywhere on the card).
        return null;
      }
      return null;
    },
    [],
  );

  const localXY = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startPinch = () => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) {
      pinchRef.current = null;
      return;
    }
    const [a, b] = pts;
    pinchRef.current = {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layoutRef.current?.posts.length) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stopInertia();
    const { x, y } = localXY(e);
    pointersRef.current.set(e.pointerId, { x, y });

    if (pointersRef.current.size >= 2) {
      // Switching into a pinch — disable the pan/click bookkeeping cleanly.
      pointerDownRef.current = false;
      samplesRef.current = [];
      startPinch();
      return;
    }

    pointerDownRef.current = true;
    setGrabbing(true);
    lastPtrRef.current = { x, y };
    downPtrRef.current = { x, y, t: performance.now() };
    samplesRef.current = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
    movedSqRef.current = 0;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const tracked = pointersRef.current.get(e.pointerId);
    if (!tracked) return;
    const { x, y } = localXY(e);
    pointersRef.current.set(e.pointerId, { x, y });

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const a = pts[0];
      const b = pts[1];
      const newDist = Math.hypot(b.x - a.x, b.y - a.y);
      const newMidX = (a.x + b.x) / 2;
      const newMidY = (a.y + b.y) / 2;
      const prev = pinchRef.current;
      if (prev.dist > 4 && newDist > 4) {
        const v = viewRef.current;
        // Zoom: keep the world point under the previous midpoint anchored,
        // then translate so the midpoint follows the user's fingers (two-finger pan).
        const wx = (prev.midX - v.panX) / v.scale;
        const wy = (prev.midY - v.panY) / v.scale;
        const newScale = clampScale(v.scale * (newDist / prev.dist));
        v.scale = newScale;
        v.panX = newMidX - wx * newScale;
        v.panY = newMidY - wy * newScale;
        requestRedraw();
      }
      pinchRef.current = { dist: newDist, midX: newMidX, midY: newMidY };
      return;
    }

    if (!pointerDownRef.current) return;
    const dx = x - lastPtrRef.current.x;
    const dy = y - lastPtrRef.current.y;
    lastPtrRef.current = { x, y };
    viewRef.current.panX += dx;
    viewRef.current.panY += dy;
    movedSqRef.current += dx * dx + dy * dy;

    const now = performance.now();
    samplesRef.current.push({ t: now, x: e.clientX, y: e.clientY });
    samplesRef.current = samplesRef.current.filter((s) => now - s.t <= SAMPLE_MS);

    requestRedraw();
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasTracked = pointersRef.current.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (pointersRef.current.size >= 2) {
      startPinch();
      return;
    }
    if (pointersRef.current.size === 1) {
      // Drop from pinch back to single-finger pan: rebase pan tracking, no inertia/click.
      pinchRef.current = null;
      const remaining = [...pointersRef.current.values()][0];
      lastPtrRef.current = { ...remaining };
      downPtrRef.current = { ...remaining, t: performance.now() };
      samplesRef.current = [];
      movedSqRef.current = 0;
      pointerDownRef.current = true;
      setGrabbing(true);
      return;
    }

    pinchRef.current = null;
    if (!pointerDownRef.current && !wasTracked) return;
    pointerDownRef.current = false;
    setGrabbing(false);

    const now = performance.now();
    const down = downPtrRef.current;
    const dt = now - down.t;
    // Straight-line displacement from pointerdown — far less twitchy than
    // accumulating per-frame squared deltas, which crossed the threshold
    // even from cursor jitter while the user paused to aim a click.
    const last = lastPtrRef.current;
    const totalDx = last.x - down.x;
    const totalDy = last.y - down.y;
    const distSq = totalDx * totalDx + totalDy * totalDy;
    const distOk = distSq < CLICK_MOVE_PX * CLICK_MOVE_PX;
    const timeOk = dt < CLICK_MS;
    const clickEvent = e.type === "pointerup";

    if (clickEvent && distOk && timeOk) {
      const { x, y } = localXY(e);
      const hit = hitTest(x, y);
      if (hit) {
        onPostActionRef.current?.(hit.post, hit.action);
      }
    } else if (!clickEvent || !distOk || !timeOk) {
      startInertiaIfNeeded();
    }
    samplesRef.current = [];
  };

  // React attaches `onWheel` as a passive listener (so calling
  // `preventDefault` warns + does nothing). Bind the native event ourselves
  // with `{ passive: false }` so wheel/trackpad zoom doesn't also scroll
  // the page behind the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      if (!layoutRef.current?.posts.length) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const v = viewRef.current;
      const wx = (sx - v.panX) / v.scale;
      const wy = (sy - v.panY) / v.scale;

      const zoom = Math.exp(-e.deltaY * 0.0018);
      const newScale = clampScale(v.scale * zoom);
      v.scale = newScale;
      v.panX = sx - wx * newScale;
      v.panY = sy - wy * newScale;
      requestRedraw();
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [requestRedraw]);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        touchAction: "none",
        cursor: grabbing ? "grabbing" : "grab",
      }}
    />
  );
}
