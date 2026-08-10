-- Fix: sim_sync_pack_dishes_from_chefly() only ever populated sim_pack_runs
-- the FIRST time it saw a shift with zero rows, then left it completely
-- alone forever after -- even though shifts get created and populated up to
-- p_horizon_days (35) ahead of the delivery date, as soon as the first paid
-- order for that date lands. In practice that means a shift often gets its
-- one-and-only snapshot when only a handful of early orders exist, and every
-- order placed afterwards (the vast majority, right up to the day before
-- delivery) is silently never reflected on the Packing page.
--
-- Caught live: the Wed 12 Aug shift snapshotted on 3 Aug with 12 dishes / 23
-- meals, then sat stale while real demand grew to 56 dishes / 1,574 meals.
-- Fixed by hand for that one date; this fixes the function so it can't
-- recur.
--
-- New behaviour, run every day for every date in the horizon:
--   - TOP UP: any sku in that day's fresh import that isn't yet in
--     sim_pack_runs for the shift gets inserted as a new pending row
--     (covers both a brand-new shift and a shift that was partially loaded
--     on an earlier day).
--   - REFRESH: any row still sitting at status='pending' (i.e. nobody has
--     hit Start on it) gets its planned_qty kept in sync with the latest
--     order total.
--   - NEVER TOUCHED: any row that is 'packing', 'done', or 'skipped'. Once
--     a human has acted on a dish, this function will not rewrite it --
--     that stays exactly the same safety contract as before.

create or replace function public.sim_sync_pack_dishes_from_chefly(p_horizon_days integer default 35)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d date;
  v_shift_id uuid;
  v_imported integer;
  v_runs_added integer;
  v_runs_refreshed integer;
  v_unmapped integer;
  dates_synced integer := 0;
  dates_added integer := 0;
  dates_refreshed integer := 0;
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

    -- TOP UP -- add any sku from today's import that this shift doesn't have
    -- yet, respecting the manager's saved sim_pack_dish_order sequence where
    -- one exists (same rule the manual packImportDishes() load uses),
    -- appended after whatever sort_order/planned_seq already exists so
    -- existing rows never get reshuffled.
    with missing as (
      select spi.dish_name, spi.sku, spi.qty,
             (row_number() over (
                order by coalesce(pdo.sort_order, 1000 + spi.sort_order)
              ) - 1)::integer as ord
      from sim_pack_dish_import spi
      left join sim_pack_dish_order pdo on pdo.sku = spi.sku
      where spi.import_date = d
        and not exists (
          select 1 from sim_pack_runs r where r.shift_id = v_shift_id and r.sku = spi.sku
        )
    ),
    base as (
      select coalesce(max(sort_order), -1) as m from sim_pack_runs where shift_id = v_shift_id
    )
    insert into sim_pack_runs (shift_id, dish_name, sku, planned_qty, sort_order, planned_seq, status)
    select v_shift_id, missing.dish_name, missing.sku, missing.qty,
           base.m + 1 + missing.ord, base.m + 1 + missing.ord, 'pending'
    from missing, base;
    get diagnostics v_runs_added = row_count;
    if v_runs_added > 0 then dates_added := dates_added + 1; end if;

    -- REFRESH -- keep planned_qty current for dishes nobody has started on
    -- yet. Rows that are packing/done/skipped are a human decision already
    -- made on the floor and must never be silently rewritten.
    update sim_pack_runs r
    set planned_qty = spi.qty
    from sim_pack_dish_import spi
    where r.shift_id = v_shift_id
      and spi.import_date = d
      and spi.sku = r.sku
      and r.status = 'pending'
      and r.planned_qty is distinct from spi.qty;
    get diagnostics v_runs_refreshed = row_count;
    if v_runs_refreshed > 0 then dates_refreshed := dates_refreshed + 1; end if;

    per_date := per_date || jsonb_build_object(
      'date', d,
      'dishes', v_imported,
      'unmapped_items', v_unmapped,
      'dishes_added', v_runs_added,
      'quantities_refreshed', v_runs_refreshed
    );
  end loop;

  return jsonb_build_object(
    'dates_synced', dates_synced,
    'dates_added', dates_added,
    'dates_refreshed', dates_refreshed,
    'per_date', per_date
  );
end;
$function$;

comment on function public.sim_sync_pack_dishes_from_chefly(integer) is
  'Syncs the packing dish list from live Chefly-website (D2C) paid orders, '
  'topping up new skus and refreshing quantities on still-pending rows every '
  'day right up to delivery, without ever touching a dish that is packing, '
  'done, or skipped. Internal/cron-only -- see the "sim-pack-dish-sync" '
  'pg_cron job. Not for client use: EXECUTE is revoked from anon/authenticated below.';

revoke all on function public.sim_sync_pack_dishes_from_chefly(integer) from public;
revoke all on function public.sim_sync_pack_dishes_from_chefly(integer) from anon, authenticated;
