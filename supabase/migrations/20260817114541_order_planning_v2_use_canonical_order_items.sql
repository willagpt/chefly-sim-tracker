-- get_order_planning_data_v2 summed public.d2c_order_items directly, so it
-- carried the same over-count as the packing sync: that table retains
-- superseded line-item rows for any order the customer has edited (the
-- upstream sync upserts by the website's OrderItem.id and can never delete),
-- so quantities only ever drift upwards. For 19 Aug 2026 this read 1,740
-- portions against the website's true 1,652 -- meaning production volumes
-- and downstream sub-recipe / raw-material requirements were BOTH overstated
-- by ~5%, on top of the packing plan being wrong.
--
-- Only the two FROM clauses change: d2c_order_items -> v_d2c_current_order_items.
-- Logic, signature, grants and return shape are untouched.

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
    from public.v_d2c_current_order_items oi
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
    from public.v_d2c_current_order_items oi
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
