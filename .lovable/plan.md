## Goal

Restore the original working dashboard UI as a **pure client-side SPA** (Vite + React + TanStack Router) and deploy it cleanly to GitHub Pages — no Nitro/SSR, no fragile `index.html` shell emission in CI.

## Why the build keeps breaking

The current project still carries TanStack **Start** (SSR) scaffolding (`src/server.ts`, `src/start.ts`, `error-capture.ts`) and the router plugin auto-detects it, triggering a Nitro SSR build. Nitro then rejects `index.html` as the input (`rollupOptions.input should not be an html file when building for SSR`) and `bun run build` exits 1. The `deploy.yml` workarounds papered over earlier failures but no longer help.

The dashboard itself doesn't need SSR — every feature is client-side (Excel parsing in browser, charts, exports). Removing the Start layer eliminates the Nitro path entirely and makes the GitHub Pages deploy boring and reliable.

## Changes

### 1. Strip TanStack Start, keep TanStack Router

- **Delete**: `src/server.ts`, `src/start.ts`, `src/lib/error-capture.ts`.
- **Edit `src/routes/__root.tsx`**: remove the `reportLovableError` import/usage so nothing references Start internals (keep the existing 404 + error UI).
- **`src/router.tsx`**: keep `createRouter` from `@tanstack/react-router` and the static `basepath: "/kpi-insights-hub/"` — this is what restores the "original" routing behavior. No `document.baseURI` gymnastics.
- **`src/main.tsx`**: already mounts `<RouterProvider>` into `#root` — no change needed.

### 2. Fix `index.html`

It is currently corrupted (orphan font-preconnect fragments on lines 8–12). Restore a clean head with proper `<link rel="preconnect">` and the Google Fonts stylesheet, plus `<script type="module" src="/src/main.tsx">`.

### 3. `vite.config.ts`

Keep as-is: plain `defineConfig` from `vite`, `base: "/kpi-insights-hub/"`, plugins `TanStackRouterVite`, `react`, `tailwindcss`, `tsconfigPaths`. With Start files gone, the router plugin will no longer enable SSR and `vite build` produces a normal SPA `dist/` with `index.html` + hashed assets.

### 4. `.github/workflows/deploy.yml`

Replace the brittle "tolerate failure + emit shell" version with a straightforward Pages deploy:

```text
checkout → setup-bun → bun install → bun run build
  → cp dist/index.html dist/404.html   (SPA refresh fallback under subpath)
  → upload-pages-artifact (path: dist)
  → deploy-pages
```

No `|| true`, no manual asset hashing, no `<base href>` injection — Vite's `base: "/kpi-insights-hub/"` already rewrites every asset URL correctly for the project page.

### 5. Verify

- Local `bun run build` exits 0 and emits `dist/index.html` referencing `/kpi-insights-hub/assets/...`.
- After push, the Action's "build" job succeeds and "deploy" publishes; refreshing `/kpi-insights-hub/anything` returns the SPA (via `404.html` fallback) and TanStack Router resolves the route.

## Files touched

- delete: `src/server.ts`, `src/start.ts`, `src/lib/error-capture.ts`
- edit: `src/routes/__root.tsx`, `src/router.tsx` (revert to static basepath), `index.html`, `.github/workflows/deploy.yml`
- unchanged: `vite.config.ts`, dashboard code in `src/routes/index.tsx`, analyzer libs, components

## Out of scope

No feature changes to the dashboard UI/logic — purely a build/deploy restoration.
