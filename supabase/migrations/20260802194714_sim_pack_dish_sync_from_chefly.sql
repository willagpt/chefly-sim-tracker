-- Auto-sync the packing dish list from the Chefly website's own D2C orders,
-- instead of relying on someone manually re-typing/pasting numbers that
-- already exist in this database (chefly-orders-sync already pulls the
-- website's orders into d2c_orders/d2c_order_items every morning at 04:45 UTC
-- via the "chefly-d2c-orders-sync" pg_cron job — this migration adds the
-- missing next hop: turning those orders into Sim Tracker's packing dish
-- list, the same table/shape the existing manual "Load orders" flow uses).
--
-- Safety contract:
--   - Only counts paid orders (excludes skipped/cancelled/refunded/
--     awaiting_payment/pending).
--   - Always refreshes sim_pack_dish_import (a staging table with no
--     operational side-effects) for every date with paid orders in the
--     horizon.
--   - Only auto-populates sim_pack_runs (the table the Packing tab actually
--     renders/times) for a shift that has ZERO existing runs. If a shift has
--     already been touched -- by this same sync on an earlier run, or by a
--     manager's manual "Load orders" -- it is left alone so a live/finished
--     pack never gets silently rewritten. A manager can still re-load
--     manually (existing confirm-gated packImportDishes()) to pick up
--     late order changes.
--   - Unmapped website products (no row in d2c_product_map) are not silently
--     dropped -- they fall back to the website's own sku/name via
--     d2c_products so the total dish count always matches reality, and the
--     unmapped count is returned so it can be reviewed/fixed in the mapping.

create or replace function public.sim_sync_pack_dishes_from_chefly(p_horizon_days integer default 35)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d date;
  v_shift_id uuid;
  v_existing_runs integer;
  v_imported integer;
  v_runs_loaded integer;
  v_unmapped integer;
  dates_synced integer := 0;
  dates_auto_loaded integer := 0;
  per_date jsonb := '[]'::jsonb;
begin
  for d in
    select distinct o.delivery_date::date
    from d2c_orders o
    where o.status = 'paid'
      and o.delivery_date::date between current_date and current_date + p_horizon_days
    order by 1
  loop
    delete from sim_pack_dish_import where import_date = d;

    insert into sim_pack_dish_import (import_date, sku, dish_name, qty, sort_order, imported_at)
    select d,
           coalesce(m.planner_sku, dp.sku, 'D2C-' || oi.product_id::text),
           coalesce(m.planner_name, dp.name, oi.product_name, 'Unknown product'),
           sum(oi.quantity)::integer,
           (row_number() over (order by sum(oi.quantity) desc) - 1)::integer,
           now()
    from d2c_orders o
    join d2c_order_items oi on oi.order_id = o.id
    left join d2c_product_map m on m.v2_product_id = oi.product_id
    left join d2c_products dp on dp.id = oi.product_id
    where o.status = 'paid' and o.delivery_date::date = d
    group by coalesce(m.planner_sku, dp.sku, 'D2C-' || oi.product_id::text),
             coalesce(m.planner_name, dp.name, oi.product_name, 'Unknown product');

    get diagnostics v_imported = row_count;
    dates_synced := dates_synced + 1;

    select count(*) filter (where m.v2_product_id is null)
      into v_unmapped
    from d2c_orders o
    join d2c_order_items oi on oi.order_id = o.id
    left join d2c_product_map m on m.v2_product_id = oi.product_id
    where o.status = 'paid' and o.delivery_date::date = d;

    select id into v_shift_id from sim_pack_shifts where shift_date = d;
    if v_shift_id is null then
      insert into sim_pack_shifts (shift_date) values (d) returning id into v_shift_id;
    end if;

    select count(*) into v_existing_runs from sim_pack_runs where shift_id = v_shift_id;
    v_runs_loaded := 0;
    if v_existing_runs = 0 then
      insert into sim_pack_runs (shift_id, dish_name, sku, planned_qty, sort_order, planned_seq, status)
      select v_shift_id, dish_name, sku, qty, sort_order, sort_order, 'pending'
      from sim_pack_dish_import
      where import_date = d;
      get diagnostics v_runs_loaded = row_count;
      dates_auto_loaded := dates_auto_loaded + 1;
    end if;

    per_date := per_date || jsonb_build_object(
      'date', d,
      'dishes', v_imported,
      'unmapped_items', v_unmapped,
      'auto_loaded_into_shift', v_runs_loaded > 0
    );
  end loop;

  return jsonb_build_object(
    'dates_synced', dates_synced,
    'dates_auto_loaded', dates_auto_loaded,
    'per_date', per_date
  );
end;
$function$;

comment on function public.sim_sync_pack_dishes_from_chefly(integer) is
  'Syncs the packing dish list from live Chefly-website (D2C) paid orders. '
  'Internal/cron-only -- see the "sim-pack-dish-sync" pg_cron job. Not for '
  'client use: EXECUTE is revoked from anon/authenticated below.';

-- This is a SECURITY DEFINER function with no internal role check (unlike
-- sim_import_pack_dishes, which is meant to be called by a logged-in
-- manager). It must NEVER be reachable over PostgREST/RPC by app users --
-- only by the pg_cron job below, which runs inside Postgres directly.
revoke all on function public.sim_sync_pack_dishes_from_chefly(integer) from public;
revoke all on function public.sim_sync_pack_dishes_from_chefly(integer) from anon, authenticated;

-- Runs daily at 05:00 UTC -- 15 minutes after chefly-d2c-orders-sync (04:45
-- UTC) so it always sees that morning's freshest order data.
select cron.schedule(
  'sim-pack-dish-sync',
  '0 5 * * *',
  $$select public.sim_sync_pack_dishes_from_chefly();$$
);
