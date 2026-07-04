# Chefly SIM Tracker — Architecture

An internal Short-Interval-Management tracker for a meat-production + meal-prep operation.
No build step: static files on Vercel, backed by Supabase (Postgres + Auth + Storage +
Realtime + Edge Functions). Pushing to `main` auto-deploys.

## Frontend

Plain HTML/CSS/JS, no framework, no bundler. `index.html` loads a set of **classic
`<script>` files that share one global scope** (they are NOT ES modules). Load order
matters and is fixed in `index.html`:

```
supabase (UMD CDN)  -> global `supabase`
core.js             -> `sb` client, shared state, helpers, photo lightbox
ui.js               -> shared render helpers: esc(), pill(), photoThumbs(), meta()
auth.js             -> login / signup / bootstrap / showApp / tab routing
tasks.js            -> task catalog, products, My-Task logging (multi-active)
kiosk.js            -> shared-device PIN flow for floor staff
dashboard.js        -> manager live board + realtime subscriptions
equipment.js        -> cooking equipment / vessel board
packing.js          -> packing team-leader screen (run sheet, positions, breaks)
performance.js      -> performance views (team / person / task / daily / time)
manage.js           -> admin: users, wall links, history/reports, log editor
boot.js             -> startup wiring (runs last)
```

Standalone screens (their own ES-module page, token-gated, no login):
`wall.html` (office board) and `packwall.html` (packing line).

### Conventions

- **Rendering is string templates set via `innerHTML`.** Always wrap user-entered
  text with `esc(...)` from `ui.js` (comments, notes, product/dish names, people's
  names). Values from a fixed list (roles, statuses) don't need escaping.
- Click handlers are global `window.fn = ...` functions referenced by inline `onclick`.
- Feature state lives in module-level `let` globals in `core.js` (e.g. `activeLogs`,
  `catalog`, `packRuns`).

## Backend (Supabase)

- **Rules are enforced at the database, not the client.** Row-Level Security on every
  table; privileged reads/writes go through `SECURITY DEFINER` RPCs; the `sim-admin`
  Edge Function (service-role) handles signup/user-admin. Data-integrity triggers
  (e.g. the >1000 kg block, required-units-on-complete) mean the UI cannot write
  values that break the rules.
- Public screens read through token-gated RPCs (`sim_public_dashboard`,
  `sim_public_equipment`, `sim_public_packing`) validated against `sim_settings.wall_token`.
- Realtime: modules subscribe to `postgres_changes` and re-render.
- Scheduled jobs (Cowork): daily packing dish-import (~06:36) and the weekly
  performance digest (Fri 17:00).

## Local development (recommended — removes whole-file edit friction)

```
git clone https://github.com/willagpt/chefly-sim-tracker
cd chefly-sim-tracker
npx vercel dev          # serves the static app locally
# edit with a normal editor, then:
git add -A && git commit -m "..." && git push   # auto-deploys
```

Database changes should be captured as versioned SQL under `supabase/migrations/`
so the schema is reproducible and reviewable.

## Roadmap (make new modules cheap, edits small)

1. **ui.js** shared helpers + `esc()` everywhere.  *(started)*
2. **db.js** data-access layer — named query functions so schema changes touch one file.
3. **Module template + tab registry** — each module exports `load()/render()/subscribe()`
   and registers its own tab; adding a module = copy template, implement three functions.
4. **ES modules** (`type="module"` + import/export) — removes global-scope coupling and
   load-order fragility; no bundler required.
5. **Types + lint** — JSDoc/TypeScript for core shapes (log, catalog, run) and
   ESLint/Prettier in CI.
