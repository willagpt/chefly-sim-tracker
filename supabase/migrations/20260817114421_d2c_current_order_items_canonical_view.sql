-- THE BUG THIS FIXES
--
-- chefly-orders-sync pulls the website's OrderItem rows and upserts them by
-- the website's own OrderItem.id. That is insert/update-only: it has NO way
-- to remove a row that no longer exists upstream. When a customer edits a
-- subscription box the website DELETES that order's OrderItem rows and
-- writes NEW ones with NEW ids -- so our copy keeps BOTH the old set and the
-- new set, and every consumer that does sum(quantity) counts them twice.
--
-- Because the old rows are only ever additive, our numbers drift strictly
-- UPWARDS over time and never downwards. Measured on the 19 Aug 2026 pack
-- day: the website reports 1,652 meals across 204 paid orders; summing the
-- raw table gave 1,744 across the same 204 orders (+92, 5.6% over). Penne
-- Bolognese (sku 63) read 90 against a true 85.
--
-- THE RULE
--
-- Every apply run of chefly-orders-sync stamps ONE identical synced_at on
-- every row it writes in that run. So for a given order, the rows carrying
-- that order's most recent synced_at are exactly the line-item set the
-- website returned on the last pull -- and anything older is a superseded
-- copy. This view keeps only the newest run's rows per order.
--
-- WHY "newest run per order" and not "row matching the order's own
-- synced_at": if an items fetch ever failed while the order row still
-- refreshed, the stricter rule would silently drop that order's dishes off
-- the pack list entirely. This rule degrades to "last known good" instead,
-- and sim_pack_order_drift() (added separately) reports any order whose
-- items are older than the order row so the case is visible, never silent.
-- Checked at time of writing: 9 such orders exist in the 60-day window and
-- all 9 are status='skipped' customers whose boxes the website empties,
-- already excluded by the status='paid' filter every consumer applies.

create or replace view public.v_d2c_current_order_items as
select oi.*
from public.d2c_order_items oi
join (
  select order_id, max(synced_at) as ts
  from public.d2c_order_items
  group by order_id
) latest
  on latest.order_id = oi.order_id
 and oi.synced_at = latest.ts;

comment on view public.v_d2c_current_order_items is
  'Live website order lines: d2c_order_items filtered to the most recent sync run per order. '
  'ALWAYS read this instead of d2c_order_items when summing quantities -- the raw table '
  'accumulates superseded copies of edited orders and over-counts. See sim_pack_order_drift().';

grant select on public.v_d2c_current_order_items to anon, authenticated, service_role;
