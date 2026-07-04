# ES-modules migration — finish-in-local-dev playbook

This is the last roadmap item. It's a mechanical change best done in the local-dev loop
(`npx vercel dev`) where you can reload the page and confirm each screen still works, then
push. Doing it there — rather than blind through whole-file commits — is what keeps the
live app (and everyone's running task timers) safe. Budget ~1–2 focused hours.

## Why it's worth doing

Today every file shares one global scope and the load order in `index.html` is load-bearing.
ES modules make each file declare exactly what it needs (`import`) and what it offers
(`export`). That removes the ordering fragility, lets ESLint's `no-undef`/`no-unused-vars`
catch real bugs, and makes new modules truly isolated.

## The one gotcha to design around

Imported bindings are **read-only**. Code today reassigns shared state across files
(`me = ...`, `catalog = ...`, `activeLogs = ...`). You cannot `import { catalog }` and then
`catalog = data` — it throws. Fix: put mutable shared state in one object and mutate its
fields.

Create `state.js`:

```js
export const S = {
  me: null, profile: null,
  catalog: [], products: [],
  activeLogs: [], kActiveLogs: [],
  timerInt: null, kTimerInt: null, kStaff: null,
  lastFinishIds: new Set(), notifyReady: false, booting: false
};
```

Then every bare reference to those names becomes `S.x` (e.g. `me.id` -> `S.me.id`,
`catalog = data` -> `S.catalog = data`, `activeLogs.unshift(x)` -> `S.activeLogs.unshift(x)`).
Use a word-boundary find (`\bcatalog\b`) so you don't touch `catalog_id`,
`sim_task_catalog`, `loadCatalog`, or `catFor`.

## Steps (per file)

1. **Move shared state** out of `core.js` into `state.js` (above). Everything else in
   `core.js` (the `sb` client, helpers, lightbox) stays and gets `export`ed.
   - Switch the Supabase client to an import instead of the UMD global:
     `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`
     and drop the `<script src="...supabase...">` tag from `index.html`.
2. **Add `export`** to every top-level `function` / `const` a file exposes.
3. **Add `import`** lines at the top of each file for the helpers/state it uses, e.g.
   `import { S } from './state.js'` and `import { esc, pill, photoThumbs } from './ui.js'`.
4. **Inline `onclick` handlers** still need `window.*`. Keep the existing
   `window.startTask = ...` assignments — they work unchanged inside a module. (Longer
   term, swap to `addEventListener` + `data-` attributes, but not required now.)
5. **Entry point.** Replace the many `<script src=...>` tags in `index.html` with a single
   `<script type="module" src="app.js"></script>`, where `app.js` imports the feature
   modules for their side effects, in the same order they load today:
   ```js
   import './core.js'; import './ui.js'; import './db.js'; import './auth.js';
   import './tasks.js'; import './kiosk.js'; import './dashboard.js';
   import './equipment.js'; import './packing.js'; import './performance.js';
   import './manage.js'; import './boot.js';
   ```
6. `wall.html` and `packwall.html` are already `type="module"` and standalone — leave them.

## Verify before pushing

- Open every screen under `npx vercel dev`: login, My Task (start/stop, multi-task),
  kiosk PIN, dashboard, equipment, packing + break tracking, history (view/edit/manual
  entry/CSV), both wall pages.
- Then flip the linter on for real value: set `"no-undef": "error"` and
  `"no-unused-vars": "warn"` in `eslint.config.mjs` and change `sourceType` to `"module"`.
  ESLint will now flag any import you forgot.
- Commit and push — Vercel deploys as usual.

## Suggested order

Do it on a branch, migrate `core.js` + `state.js` + `ui.js` + `db.js` first (the shared
base), confirm the app still boots, then one feature file at a time. Each feature file is
independent once the base exports are in place.
