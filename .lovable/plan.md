## Goal

Get GitHub Pages deploying successfully. The current `bun run build` runs TanStack Start's Nitro SSR pipeline, which fails with `rollupOptions.input should not be an html file when building for SSR`. Pages can only host static files anyway, so we add a parallel SPA-only build path used exclusively by the Pages workflow. Local dev and the Lovable preview keep using the TanStack Start pipeline unchanged.

The app's UI, components, styles, routes, and behavior do not change. Only the build/output for the Pages deploy changes.

## What we add

1. **`index.html`** at the project root — a minimal SPA shell that mounts `src/main.tsx`. Used only by the SPA build.
2. **`src/main.tsx`** — client entry that creates the router (reusing the existing `src/router.tsx`) with browser history and calls `RouterProvider`. Imports `src/styles.css`.
3. **`vite.config.pages.ts`** — a standalone Vite config (no `@lovable.dev/vite-tanstack-config`, no Nitro, no TanStack Start plugin's SSR wiring). It uses:
   - `@tanstack/router-plugin/vite` to generate `routeTree.gen.ts` from `src/routes/`
   - `@vitejs/plugin-react`
   - Tailwind v4 via `@tailwindcss/vite`
   - `base: process.env.VITE_BASE || '/'`
   - `build.outDir: 'dist'`
4. **`.github/workflows/deploy.yml`** — update the build step to run `bunx vite build --config vite.config.pages.ts` and upload `dist/` (with `404.html` SPA fallback + `.nojekyll`) instead of `.output/public`.

## What we don't touch

- `src/routes/**`, `src/components/**`, `src/lib/**`, `src/styles.css` — zero changes.
- `src/router.tsx`, `src/routes/__root.tsx` — used by both builds.
- `src/server.ts`, `src/start.ts`, `vite.config.ts` — keep working for local dev and Lovable preview.
- `package.json` `build` script — unchanged so the Lovable sandbox keeps working.

## Constraints this introduces

- All loaders/components must remain client-safe (no `createServerFn`, no Node-only imports at module scope). The dashboard is already 100% client-side (SheetJS in the browser, in-memory state), so this matches reality.
- Any future server-only feature would need to live behind the TanStack Start path and wouldn't appear on the Pages deploy. Acceptable for a stateless dashboard.

## Visual impact

None. Same React tree, same Tailwind styles, same routes. The only user-visible change is that `https://<user>.github.io/kpi-insights-hub/` will start loading the app instead of returning a build failure.

## Verification

After the change: push to `main`, watch the Actions run go green, open the Pages URL, confirm the dashboard renders, upload a sample file, and confirm a hard refresh on a sub-route (e.g. `/queues`) still works (404.html fallback).

## Files

- add `index.html`
- add `src/main.tsx`
- add `vite.config.pages.ts`
- edit `.github/workflows/deploy.yml`
