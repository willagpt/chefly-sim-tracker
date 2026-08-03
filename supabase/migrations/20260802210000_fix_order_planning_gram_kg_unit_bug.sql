-- Fix: get_order_planning_data(), get_order_planning_data_v2() and
-- get_order_sub_recipe_demand() were summing finished_product_components.qty
-- directly (sum(oi.quantity * coalesce(fpc.qty,1))) without ever looking at
-- fpc.uom. Recipe data in that table is recorded in mixed units -- most rows
-- are 'Kg' (e.g. 0.12), but 33 rows are 'gr' (e.g. 120, meaning the same
-- 0.12kg) -- so any row recorded in grams was being treated as if it were
-- already in kilograms, overstating that sub-recipe's demand by ~1000x.
--
-- Caught by comparing the 5 Aug order-planning output against the real TCK
-- Produce order: "Japanese Chicken Breast" sub-recipe demand reported as
-- 11300.93 (vs a sane few dozen) traced exactly to the "Chicken Teriyaki,
-- Wild Rice and Tenderstem Broccoli" component row, which is 120 gr but was
-- read as 120 kg (94 orders x 120 = 11280, matching the reported total to
-- the cent once the other correctly-recorded Kg rows are added). Same
-- signature confirmed on Teriyaki Sauce CS1, Peppercorn Sauce CS7, the
-- Tenderstem Broccoli mix, and three "Toasted" garnish sub-recipes.
--
-- Fix: normalize fpc.qty to kilograms before multiplying, converting any
-- 'gr'/'g' row by /1000. 'Kg'/'kg' rows pass through unchanged. Rows with
-- uom 'EA' or blank represent piece counts for sub-recipes that are
-- consistently EA-denominated across all their component rows (checked --
-- no sub-recipe mixes EA with a weight unit), so those are left as-is; only
-- the gr/kg weight mismatch was ever silently double-counted.

create or replace function public.get_order_planning_data(target_date date)
returns jsonb
language plpgsql
security definer
set statement_timeout to '15s'
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  order_ids int[];
  order_count bigint;
  product_data jsonb;
  sr_data jsonb;
begin
  select array_agg(id) into order_ids
  from public.d2c_orders
  where delivery_date >= target_date::timestamptz
    and delivery_date < (target_date + interval '1 day')::timestamptz
    and status = 'paid';

  if order_ids is null then
    return jsonb_build_object('order_count',0,'products','[]'::jsonb,'sub_recipes','[]'::jsonb);
  end if;
  order_count := array_length(order_ids,1);

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.product_name),'[]'::jsonb)
  into product_data
  from (
    select m.planner_sku::text as sku,
           fp.name as product_name,
           coalesce(nullif(btrim(fp.name_short),''), fp.name) as product_short_name,
           sum(oi.quantity)::bigint as total_qty
    from public.d2c_order_items oi
    join public.d2c_product_map m on m.v2_product_id = oi.product_id
    join public.finished_products fp on fp.sku = m.planner_sku and fp.active = true
    where oi.order_id = any(order_ids)
    group by m.planner_sku, fp.name, fp.name_short
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sub_recipe_name),'[]'::jsonb)
  into sr_data
  from (
    select sr.id::text as sub_recipe_id, sr.name as sub_recipe_name, sr.production_area,
           sr.yield_qty, sr.category,
           sum(oi.quantity * coalesce(
             case when lower(fpc.uom) in ('gr','g') then fpc.qty / 1000.0 else fpc.qty end
           , 1)) as total_needed,
           array_agg(distinct fp.name) as from_products,
           array_agg(distinct coalesce(nullif(btrim(fp.name_short),''), fp.name)) as from_products_short
    from public.d2c_order_items oi
    join public.d2c_product_map m on m.v2_product_id = oi.product_id
    join public.finished_products fp on fp.sku = m.planner_sku and fp.active = true
    join public.finished_product_components fpc on fpc.finished_product_id = fp.id
    join public.sub_recipes sr on sr.id = fpc.sub_recipe_id and sr.active = true
    where oi.order_id = any(order_ids)
    group by sr.id, sr.name, sr.production_area, sr.yield_qty, sr.category
  ) t;

  return jsonb_build_object('order_count',order_count,'products',product_data,'sub_recipes',sr_data);
end;
$function$;

create or replace function public.get_order_planning_data_v2(target_date date)
returns jsonb
language plpgsql
security definer
set statement_timeout to '15s'
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  order_ids int[];
  order_count bigint;
  product_data jsonb;
  sr_data jsonb;
begin
  select array_agg(id) into order_ids
  from public.d2c_orders
  where delivery_date >= target_date::timestamptz
    and delivery_date < (target_date + interval '1 day')::timestamptz
    and status = 'paid';

  if order_ids is null then
    return jsonb_build_object('order_count',0,'products','[]'::jsonb,'sub_recipes','[]'::jsonb);
  end if;
  order_count := array_length(order_ids,1);

  -- Product demand: keyed on the authoritative planner SKU + name via the locked map
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.product_name),'[]'::jsonb)
  into product_data
  from (
    select m.planner_sku::text as sku,
           fp.name as product_name,
           sum(oi.quantity)::bigint as total_qty
    from public.d2c_order_items oi
    join public.d2c_product_map m on m.v2_product_id = oi.product_id
    join public.finished_products fp on fp.sku = m.planner_sku and fp.active = true
    where oi.order_id = any(order_ids)
    group by m.planner_sku, fp.name
  ) t;

  -- Sub-recipe demand through the finished-product components
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sub_recipe_name),'[]'::jsonb)
  into sr_data
  from (
    select sr.id::text as sub_recipe_id,
           sr.name as sub_recipe_name,
           sr.production_area,
           sr.yield_qty,
           sr.category,
           sum(oi.quantity * coalesce(
             case when lower(fpc.uom) in ('gr','g') then fpc.qty / 1000.0 else fpc.qty end
           , 1)) as total_needed,
           array_agg(distinct fp.name) as from_products
    from public.d2c_order_items oi
    join public.d2c_product_map m on m.v2_product_id = oi.product_id
    join public.finished_products fp on fp.sku = m.planner_sku and fp.active = true
    join public.finished_product_components fpc on fpc.finished_product_id = fp.id
    join public.sub_recipes sr on sr.id = fpc.sub_recipe_id and sr.active = true
    where oi.order_id = any(order_ids)
    group by sr.id, sr.name, sr.production_area, sr.yield_qty, sr.category
  ) t;

  return jsonb_build_object('order_count',order_count,'products',product_data,'sub_recipes',sr_data);
end;
$function$;

create or replace function public.get_order_sub_recipe_demand(target_date date)
returns table(sub_recipe_id text, sub_recipe_name text, production_area text, yield_qty numeric, category text, total_needed numeric, from_products text[])
language plpgsql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  order_ids int[];
begin
  select array_agg(o.id) into order_ids
  from chefly.orders o
  where o.delivery_date >= target_date::timestamptz
    and o.delivery_date < (target_date + interval '1 day')::timestamptz
    and o.status = 'paid';

  if order_ids is null then
    return;
  end if;

  return query
  select
    sr.id::text as sub_recipe_id,
    sr.name as sub_recipe_name,
    sr.production_area,
    sr.yield_qty,
    sr.category,
    sum(op.quantity * coalesce(
      case when lower(fpc.uom) in ('gr','g') then fpc.qty / 1000.0 else fpc.qty end
    , 1)) as total_needed,
    array_agg(distinct wp.name) as from_products
  from chefly.order_products op
  join public.website_products wp on wp.sku = op.product_id::text and wp.is_active = true
  join public.finished_products fp on fp.sku = wp.sku and fp.active = true
  join public.finished_product_components fpc on fpc.finished_product_id = fp.id
  join public.sub_recipes sr on sr.id = fpc.sub_recipe_id and sr.active = true
  where op.order_id = any(order_ids)
  group by sr.id, sr.name, sr.production_area, sr.yield_qty, sr.category
  order by sr.name;
end;
$function$;

comment on function public.get_order_planning_data_v2(date) is
  'Order-planning sub-recipe/product demand for a delivery date, from live D2C paid orders. '
  'Normalizes finished_product_components.qty to kg before summing (gr/g rows divided by 1000) '
  '-- fixed 2 Aug 2026 after a gr-read-as-kg bug overstated several sub-recipes'' demand ~1000x '
  '(e.g. Japanese Chicken Breast reporting 11300.93 instead of ~11.3).';
