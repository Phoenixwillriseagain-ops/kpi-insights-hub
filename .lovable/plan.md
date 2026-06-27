
## Goal

Restore Pulse v2 exactly as it was (the version in your screenshot — three upload slots, Overview/Trends/Queues/KSL-5b/KSL-4 & KM-1 tabs, weekly line charts with companion tables, exports) and make it deploy cleanly to GitHub Pages on Node 24, without touching any of the dashboard UI, graphs, or logic.

## Step 1 — You revert (no code from me)

Use the History tab and pick the message that matches the Pulse v2 screenshot (the one right before the SSR/Nitro debugging started). That gives you the *exact* old files — same components, same charts, same behavior. Reconstructing from memory would risk visual or logic drift, so this step is yours.

```
<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>
```

## Step 2 — I patch deployment only

Once you've reverted, I will touch **only these three files** — no component, route, chart, or analyzer file changes:

1. **`.github/workflows/deploy.yml`** — pin Node 24, standard Vite build → `dist/` → `actions/upload-pages-artifact` → `actions/deploy-pages`. Adds a `cp dist/index.html dist/404.html` step for the SPA fallback.
2. **`vite.config.ts`** — set `base: "/<repo-name>/"` so hashed `assets/*.js` and `assets/*.css` resolve under the GitHub Pages subpath.
3. **`src/router.tsx`** (only if it currently hardcodes a different basepath) — align `basepath` with the Vite `base` so client routing stays inside `/<repo>/`.

### Workflow shape (for reference)

```text
on: push to main  →  actions/checkout
                  →  actions/setup-node @ node-version: 24, cache: npm
                  →  npm ci
                  →  npm run build
                  →  cp dist/index.html dist/404.html
                  →  actions/configure-pages
                  →  actions/upload-pages-artifact (path: dist)
                  →  actions/deploy-pages
```

Permissions: `pages: write`, `id-token: write`, `contents: read`. Concurrency group `pages` so deploys don't overlap.

## Out of scope

- No changes to `src/routes/index.tsx`, `src/lib/analyzer/*`, styling, or any chart/table component.
- No SSR, no Nitro, no TanStack Start server entry — pure SPA, same as the restored version.

## After you approve

I'll wait for you to revert via History, then on your next message I'll apply the three deployment edits above. Push syncs to your connected GitHub repo and the Actions run publishes to Pages.
