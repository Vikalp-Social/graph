# Topic Map — vikalp.social

An interactive **topic cluster map** for Mastodon. Posts from your home timeline, public feed, or trending are clustered by an LLM and rendered as a zoomable, pannable canvas — each topic is a coloured bubble, each post is a card you can like, boost, or reply to in place.

Live at **[graph.vikalp.social](https://graph.vikalp.social)** · part of the **[vikalp.social](https://vikalp.social)** suite alongside the [8-bit RPG feed](https://8bit.vikalp.social).

---

## Features

- **Canvas topic map** — clusters laid out with a force-directed algorithm; zoom and pan freely
- **Post cards** — hover a cluster to see its posts; like, boost, reply, and open threads inline
- **Three feed sources** — Home (your timeline), Timeline (public), Trending
- **Responsive chrome** — on desktop the source selector, stats, refresh, support link, and account sit inline on the top bar; below 640px they collapse into a ☰ slide-in drawer
- **Loading overlay** — selecting a feed shows a full-map "Clustering…" overlay while the LLM groups posts
- **Support link** — a Ko-fi "Support Vikalp" link in the chrome and on the sign-in screen
- **`#nobot` / `#noai` filtering** — accounts with these tags in their bio are excluded before clustering
- **1-hour local cache** — clusters are cached in `localStorage` per source; reload is instant within the hour; "Reload" button busts the cache and re-clusters
- **Shared login** — sign in once at [vikalp.social](https://vikalp.social); the session cookie carries to this app automatically

---

## Architecture

Auth and data go through the shared **api-server** (same one used by the 8-bit RPG). The browser makes no direct calls to Mastodon or the ML service.

```
graph.vikalp.social (Firebase Hosting)
        │
        └─► /api/** → api-server (Cloud Run, europe-north1)
                  ├── GET  /api/auth/me
                  ├── POST /api/auth/mastodon/begin|logout
                  ├── GET  /api/mastodon/clusters?source=home|timeline|trending
                  ├── POST /api/mastodon/posts/:id/favourite|boost|reply
                  ├── GET  /api/mastodon/posts/:id/context
                  └── GET  /api/mastodon/resolve?url=
```

Clusters are cached client-side (1h TTL in `localStorage`). The api-server is stateless — no server-side cache.

---

## Getting started locally

The [clustering-backend](https://github.com/vikalp-social/clustering-backend) (api-server + ml-service) must be running for full functionality.

```bash
# 1. Start the backend (see clustering-backend repo)

# 2. Start this frontend
npm install
npm run dev
```

**Default URL:** `http://localhost:5173`

The Vite dev server proxies `/api/**` to `localhost:8080` (api-server port) automatically. Set `API_PORT` env var if your api-server runs on a different port.

---

## Scripts

```bash
npm run dev        # start dev server with HMR
npm run build      # production build → dist/
npm run preview    # preview production build locally
```

Type-checking runs as part of `build`. To check without building:

```bash
npx tsc --noEmit
```

---

## Tech stack

- **React 19** + **TypeScript**
- **Vite 6**
- **Canvas API** — all cluster map rendering is hand-drawn (no charting library); see `src/components/TopicMapCanvas.tsx` and `src/canvas/`
- **No CSS framework** — all styles are inline

---

## Project structure

```
src/
├── App.tsx                    Main component — auth, data loading, action handlers
├── api/
│   ├── mastodonAuth.ts        Session helpers (fetchSession, startLogin, clearSession)
│   ├── clusters.ts            fetchClusters + localStorage cache
│   └── mastodon.ts            Action wrappers (favourite, boost, reply, context, resolve)
├── canvas/
│   ├── drawPostCard.ts        Post card renderer
│   └── timeAgo.ts             Relative time formatter
├── components/
│   ├── TopicMapCanvas.tsx     Main canvas component (layout, zoom, pan, hit-testing)
│   ├── LoginPanel.tsx         Mastodon instance input → api-server OAuth redirect
│   ├── RepliesPopup.tsx       Thread view (ancestors + descendants)
│   ├── ReplyPopup.tsx         Compose reply modal
│   └── ImageViewer.tsx        Full-screen image overlay
├── layout/
│   └── clusterLayout.ts       Force-directed layout + PostRect types
└── types/
    └── clusters.ts            ClustersResponse, TopicCluster, FeedSource types
```

---

## Auth flow

Login is handled by the api-server (Mastodon OAuth 2.0):

1. User enters their instance in `LoginPanel` → redirected to `/api/auth/mastodon/begin?instance=…`
2. Instance redirects back to `/api/auth/mastodon/callback?code=…`
3. api-server exchanges code for token, stores it in a signed `__session` cookie (`domain=.vikalp.social` in production)
4. App calls `GET /api/auth/me` on load — if the cookie is present, returns `{ loggedIn: true, username, avatar, instance }`

Because the cookie is scoped to `.vikalp.social`, logging in on `vikalp.social` or `8bit.vikalp.social` works here too without re-authenticating.

---

## Deployment

Built and deployed by `deploy/deploy.sh --frontend` in the companion deploy repo. The build output (`dist/`) is uploaded to Firebase Hosting (`graph.vikalp.social`).
