-- The sync could ADD dishes and RAISE quantities, but never remove a dish
-- that stopped being ordered -- the same one-directional flaw that caused
-- the original over-count. Result on 19 Aug 2026: Tuscan Sausage (2),
-- Seafood Chowder (1) and Jollof Rice with Grilled Chicken (2) all sat on
-- the pack list with zero live orders behind them, so the line would have
-- packed 5 meals that nobody bought and the kitchen would have prepped
-- components for three dishes it did not need.
--
-- This adds a PRUNE step, deliberately hedged so it can never eat a real
-- pack list:
--   * only runs when that date's import returned at least one row, so a
--     failed/empty upstream pull can never be read as "nothing is ordered";
--   * only touches rows still status='pending';
--   * only touches rows no human has been near -- no start/finish time, no
--     qty packed, no line count, no changeover, no note, no photo, no CCP
--     temperature reading;
--   * only removes a sku with NO row at all in that date's fresh import.
-- Anything failing those tests is left alone and reported by
-- sim_pack_reconcile() as 'not_ordered_but_in_plan' for a human to judge.

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
  v_runs_pruned integer;
  v_unmapped integer;
  dates_synced integer := 0;
  dates_added integer := 0;
  dates_refreshed integer := 0;
  dates_pruned integer := 0;
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
    join v_d2c_current_order_items oi on oi.order_id = o.id
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
    join v_d2c_current_order_items oi on oi.order_id = o.id
    left join d2c_product_map m on m.v2_product_id = oi.product_id
    where o.status = 'paid' and o.delivery_date::date = d;

    select id into v_shift_id from sim_pack_shifts where shift_date = d;
    if v_shift_id is null then
      insert into sim_pack_shifts (shift_date) values (d) returning id into v_shift_id;
    end if;

    -- TOP UP -- add any sku from this date's import the shift doesn't have yet,
    -- respecting the manager's saved sim_pack_dish_order sequence and appended
    -- after existing rows so nothing already on the list gets reshuffled.
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

    -- REFRESH -- keep planned_qty current for dishes nobody has started yet.
    -- packing/done/skipped rows are a human decision already made on the floor
    -- and are never silently rewritten; sim_pack_reconcile() reports those.
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

    -- PRUNE -- drop untouched pending dishes that have no live orders behind
    -- them. Guarded by v_imported > 0 so an empty/failed pull can never be
    -- mistaken for "nothing is ordered today".
    v_runs_pruned := 0;
    if v_imported > 0 then
      delete from sim_pack_runs r
      where r.shift_id = v_shift_id
        and r.status = 'pending'
        and r.start_time is null
        and r.finish_time is null
        and r.qty_packed is null
        and r.line_count is null
        and r.changeover_mins is null
        and r.pack_seq is null
        and r.notes is null
        and coalesce(array_length(r.notes_photos, 1), 0) = 0
        and r.start_temp_c is null
        and r.finish_temp_c is null
        and not exists (
          select 1 from sim_pack_dish_import spi
          where spi.import_date = d and spi.sku = r.sku
        );
      get diagnostics v_runs_pruned = row_count;
      if v_runs_pruned > 0 then dates_pruned := dates_pruned + 1; end if;
    end if;

    per_date := per_date || jsonb_build_object(
      'date', d,
      'dishes', v_imported,
      'unmapped_items', v_unmapped,
      'dishes_added', v_runs_added,
      'quantities_refreshed', v_runs_refreshed,
      'dishes_pruned', v_runs_pruned
    );
  end loop;

  return jsonb_build_object(
    'dates_synced', dates_synced,
    'dates_added', dates_added,
    'dates_refreshed', dates_refreshed,
    'dates_pruned', dates_pruned,
    'per_date', per_date
  );
end;
$function$;

revoke all on function public.sim_sync_pack_dishes_from_chefly(integer) from public;
revoke all on function public.sim_sync_pack_dishes_from_chefly(integer) from anon, authenticated;
