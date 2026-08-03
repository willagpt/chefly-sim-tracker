# PRD: Menu R&D Hub — one recipe, auto-costed, auto-nutrition, client-visible, lockable to production

**Status**: Draft
**Author**: Drafted with Claude, for James
**Last Updated**: 3 August 2026
**Version**: 0.1

---

## 1. Problem Statement

Menu development for client (white-label/brand-partner) dishes currently runs through three disconnected systems and a lot of manual re-typing: early iteration happens on paper or in a spreadsheet, then gets keyed into MarketMan for costing, then keyed a second time into Nutritics for nutritionals, then the results get manually assembled and emailed to the client for tasting feedback. Feedback ("less spice, more carbs") triggers another lap through all three systems. Once a client finally signs off, there's no clean handoff — the approved recipe has to be re-entered again to actually go into production.

The cost isn't just developer time. There's no single place showing a client (or the team) what version is current, what's changed between iterations, what the nutrition actually is right now, or whether the number the client is looking at matches what's costed. Sign-off is an email, not a state. And this project's own data already shows why that matters: this session found a live unit-conversion bug (grams read as kilograms) and 521 recipe-ingredient rows with no ingredient actually linked, both silently distorting real numbers, in the *existing* ingredient/recipe schema. A process built on paper → 3 manual re-entries → email is exactly the kind of process that produces errors like that and doesn't catch them until someone compares against reality by hand, as we just did.

**Evidence:**
- Direct account (this conversation): the same recipe currently has to be entered in up to three separate systems (spreadsheet/paper, MarketMan, Nutritics) with no shared identity between them.
- Confirmed this session: the underlying ingredient/recipe database this business already runs production on contains real, previously-unnoticed data-integrity bugs — evidence that manual, unautomated recipe data is fragile even *after* it's typed in once, let alone three times.
- Nutritics has a documented API (submit recipe/ingredient composition → get back a compliant nutrition panel, up to 258 nutrients, UK/EU/US/AU/ZA formats) — the automation the client wants is not blocked by Nutritics; it's blocked by not having built the bridge.

---

## 2. Goals & Success Metrics

| Goal | Metric | Current (estimated) | Target |
|---|---|---|---|
| Cut re-entry | # of systems a dev types the same recipe into | 3 (paper/sheet, MarketMan, Nutritics) | 1 |
| Faster iteration | Time from "recipe drafted" to "client sees costed + nutrition version" | Hours–days (manual assembly + email) | Minutes (auto-generated on save) |
| Client visibility | How a client checks current status | Waits for an email | Opens a standing link, always current |
| Clean sign-off | Steps between "client approves" and "in production" | Manual re-entry into production system | 0 — approval *is* the production record |
| Trust the numbers | Known unit/data-integrity bugs in the underlying recipe data | 2 found and fixed this session (grams-as-kg; orphaned ingredient links) | A data-quality pass completed before this becomes client-facing |

---

## 3. Non-Goals (v1)

- **Not** replacing MarketMan as the live procurement/ordering system — it stays how you actually buy from suppliers. This hub owns *development-stage* costing so nobody has to hand-cost in MarketMan just to test an idea.
- **Not** replacing Nutritics as the compliance system of record for nutrition labels — this hub automates the *submission and retrieval*, not the underlying calculation engine or label compliance responsibility.
- **Not** full client accounts/logins in v1 — reusing the same token-gated, no-login link pattern already proven in your `wall.html`/`packwall.html` boards. Real per-person accounts can come later if a client specifically needs audit-level access control.
- **Not** rebuilding recipe costing/inventory for the whole business — scoped to the *development and sign-off* pipeline for client dishes. It plugs into the same `ingredients`/`sub_recipes`/`finished_products` tables your production system already uses, rather than creating a fourth parallel data model.

---

## 4. Personas & User Stories

**Menu Developer (internal)** — creates and iterates on a dish for a client brief.
- *Story*: As a menu developer, I want to draft a recipe with ingredients and quantities and immediately see its cost and (once Nutritics is connected) its nutrition panel, so I stop re-typing the same recipe into three tools.
  - Given a draft recipe with ingredient lines, when I save it, then cost recalculates automatically from ingredient prices already in the system.
  - Given a saved draft, when I request nutrition, then the composition is submitted to Nutritics and the returned panel attaches to that specific version (or, until API access is confirmed, a clear "paste Nutritics export here" step attaches it just as durably).
  - Given client feedback on version 3, when I create version 4, then version 3 stays visible in history with its own cost/nutrition/feedback intact.

**Client / Brand Partner (external)** — reviews and gives feedback on dishes being developed for their brand.
- *Story*: As a client, I want one link that always shows the current state of a dish, so I don't have to track email threads.
  - Given a shared project link, when I open it, then I see the current version's nutrition panel, recipe description, status (e.g. "Awaiting your feedback"), and the history of prior versions and my own past comments.
  - Given I want a change, when I leave feedback on a version, then it's timestamped and visible to the whole team, not buried in an inbox.
  - Given I approve a version, when I mark it approved, then that becomes the official signed-off record.

**Ops Manager** — owns handoff from "approved" to "in production."
- *Story*: As an ops manager, I want approving a recipe to *be* the production-ready record, so nothing gets re-typed or drifts between what the client signed off and what actually gets made.
  - Given a client-approved version, when I lock it, then it's frozen (no further silent edits) and becomes/updates the corresponding `finished_product`/`sub_recipe` entry your packing and ordering systems already read from.

---

## 5. Solution Overview

**Data model.** Add a development layer alongside your existing `ingredients` / `sub_recipes` / `finished_products` schema rather than beside it in a new system: a `dev_recipes` table (one row per dish-in-development, linked to a client/project), `dev_recipe_versions` (one row per iteration — v1, v2, v3…), and `dev_recipe_ingredients` (ingredient lines per version, reusing your existing `ingredients` table so pricing is never duplicated). Draft versions never touch live `sub_recipes`/`finished_products` — those only get written (or updated) at the "Approve & Lock" step, so in-progress iteration can never leak into what the production floor is actually running.

**Auto-costing.** The moment a developer saves ingredient lines against a version, cost rolls up from the same ingredient price data already in Supabase — no MarketMan re-entry required at this stage. (Given what this session found — a gr/kg unit bug and 521 orphaned ingredient links already sitting in this exact schema — Phase 1 includes a short data-quality pass on ingredient pricing/units *before* this becomes something a client sees numbers from. Trustworthy automation on top of untrustworthy source data is worse than the manual process it replaces.)

**Auto-nutrition.** Each version's ingredient composition gets submitted to the Nutritics API (once access is confirmed — see Open Questions) and the returned panel is cached against that version, so it never needs re-requesting unless ingredients change. Until API access is live, the same slot is filled by a "paste the Nutritics export" step — same data model, same client-facing result, manual for now, swapped to automatic later with no rework.

**Client board.** One shareable, token-gated link per client project — the same no-login pattern as `wall.html`/`packwall.html`, so it's infrastructure you already trust and operate. It shows: current version's recipe summary, nutrition panel, status (Draft / Costed / Sent for Tasting / Client Feedback / Approved & Locked), and a running feedback thread tied to specific versions so "less spice, more carbs" is a timestamped record, not a lost email. **Open question below**: whether raw ingredient cost is something you want a client seeing at all, versus keeping cost internal-only and showing the client recipe + nutrition + status.

**Sign-off → production.** "Approve & Lock" is a single manager action that (a) freezes the version so it can't be silently edited, and (b) writes it into `finished_products`/`sub_recipes`/`finished_product_components` — the exact tables your packing and order-planning systems already read from. The approved, nutrition-checked, client-signed-off version *is* the production record; there is no separate "now put it in the real system" step.

**Key design decisions:**
- **Own ingredient data for dev-stage cost, not MarketMan** (your call, confirmed): faster iteration, no double entry during testing. MarketMan stays authoritative for actual procurement once something's in production.
- **Link-only client sharing, not accounts** (your call, confirmed): reuses proven infrastructure, ships faster. Can be upgraded to real accounts later without changing the underlying data model.
- **Manual Nutritics bridge as a same-shaped placeholder for the API**: means Phase 1 isn't blocked on Nutritics access being sorted, and swapping to live API later is invisible to the rest of the system.

---

## 6. Technical Considerations

**Dependencies:**
| Dependency | Needed for | Owner | Timeline risk |
|---|---|---|---|
| Nutritics API access/credentials | Automated nutrition pull (Phase 2) | James (in progress) | Medium — Phase 1 doesn't block on this |
| Data-quality pass on ingredient pricing/units | Trustworthy auto-costing | Dev team | Low — scoped, same tables already audited this session |
| Decision on client-visible cost | Client board design | James | Low, but blocks final board layout |

**Known Risks:**
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Nutritics API access delayed or plan doesn't include it | Medium | Medium | Manual paste-in bridge ships in Phase 1; swap-in later, no rework |
| Ingredient cost/unit data has more undiscovered bugs (two found already this session) | Medium | High | Data-quality pass before client-facing launch; add a sense-check (e.g. flag any line >3x a rolling average) rather than trusting the number silently |
| Client expects to see costs they shouldn't (competitively sensitive) | Low–Medium | Medium | Confirm before build — see Open Questions |
| Draft iteration accidentally affects live production data | Low | High | Architecture keeps drafts in separate tables; production tables are only touched at explicit "Approve & Lock" |

**Open Questions (resolve before Phase 3 build):**
- [ ] Should the client-facing board show ingredient cost at all, or nutrition/recipe/status only, with cost staying internal? — Owner: James
- [ ] Confirm Nutritics API access/tier and get credentials — Owner: James (in progress)
- [ ] Does "client" ever mean more than one brand partner viewing the *same* project (shared link vs. one link per stakeholder)? — Owner: James
- [ ] Should locking a version also archive/notify anyone (e.g. a Slack/email ping to ops when something's approved)? — Owner: James

---

## 7. Phased Plan

| Phase | Scope | Gate to move on |
|---|---|---|
| **0 — Data quality** | Audit ingredient pricing & units in the existing schema (extending this session's findings) before it's trusted for client-facing numbers | Known bugs fixed, spot-checked against a real recent recipe |
| **1 — Core dev hub (internal only)** | `dev_recipes`/`dev_recipe_versions`/`dev_recipe_ingredients` tables; draft → auto-cost flow; manual Nutritics paste-in slot; internal version history | A menu developer can draft, iterate, and see live cost without opening MarketMan |
| **2 — Nutritics API** | Swap manual paste-in for live API submit/retrieve, once access confirmed | Nutrition panel appears automatically on save, matching a manually-pulled control case |
| **3 — Client board** | Token-gated shareable link per project; recipe summary, nutrition, status, feedback thread | A real client project is shared and a real round of feedback happens on it |
| **4 — Approve & Lock → production** | Manager lock action writes/updates `finished_products`/`sub_recipes`/`finished_product_components` | One real approved dish flows into production with zero manual re-entry |

---

## 8. Appendix

- This session's live findings, directly relevant to Phase 0: gr/kg unit-conversion bug fixed in `get_order_planning_data`/`_v2`/`get_order_sub_recipe_demand` (2 Aug 2026); 521 `sub_recipe_ingredients` rows with `ingredient_id IS NULL` across 232 sub-recipes, not yet fixed, needs a domain-expert relinking pass.
- Nutritics API: [Nutrition, allergens & carbon footprint API](https://www.nutritics.com/en/services/api) — recipe submission and compliant nutrition panel generation confirmed available.
- Comparable commercial products (for context, not a build blocker): [meez](https://www.getmeez.com/) (version-controlled recipe hub, auto-costing incl. MarketMan sync, auto nutrition labeling), Apicbase, FoodChainID — confirms this is a known, solvable category rather than a bespoke problem.

Sources:
- [Nutrition, allergens & carbon footprint API | Nutritics](https://www.nutritics.com/en/services/api)
- [Real-Time Nutrition and Food Data API | Nutritics](https://www.nutritics.com/en/product/food-data-api/)
- [meez — Recipe Management & Food Costing Software](https://www.getmeez.com/)
