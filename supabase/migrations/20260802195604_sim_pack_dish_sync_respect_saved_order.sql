-- Fix: sim_sync_pack_dishes_from_chefly() was sorting the auto-loaded dish
-- list by quantity descending (its own default), completely ignoring
-- sim_pack_dish_order -- the manager's saved "how we actually pack this"
-- sequence, which the existing manual packImportDishes() flow always
-- respects. Caught live: Wednesday 5 Aug loaded in qty order instead of the
-- saved order (Penne Bolognese, Chicken Teriyaki, Teriyaki Salmon, ... first
-- vs Grilled Bavette Steak, Brisket and Mash, ... first). That date's
-- already-loaded sim_pack_runs was corrected by hand; this fixes the
-- function itself so every future date gets the saved order automatically,
-- exactly like a manual load would.

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
      -- Mirrors packImportDishes() in packing.js exactly: respect the
      -- manager's saved sim_pack_dish_order sequence where one exists for a
      -- sku, otherwise fall back to import order (offset by 1000 so unsaved
      -- dishes sort after every saved one, same as the manual path).
      with ordered as (
        select spi.dish_name, spi.sku, spi.qty,
               (row_number() over (
                  order by coalesce(pdo.sort_order, 1000 + spi.sort_order)
                ) - 1)::integer as ord
        from sim_pack_dish_import spi
        left join sim_pack_dish_order pdo on pdo.sku = spi.sku
        where spi.import_date = d
      )
      insert into sim_pack_runs (shift_id, dish_name, sku, planned_qty, sort_order, planned_seq, status)
      select v_shift_id, dish_name, sku, qty, ord, ord, 'pending'
      from ordered;
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
