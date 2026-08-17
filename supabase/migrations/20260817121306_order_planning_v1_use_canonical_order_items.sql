-- get_order_planning_data (the v1 planner, superseded by v2 in
-- 20260729064618_order_planning_cutover_to_v2 but never dropped) still summed
-- public.d2c_order_items directly and is still EXECUTE-able by anon and
-- authenticated -- so it remained a live route to the same inflated numbers
-- the v2 fix removed. Anything still calling it, now or later, would silently
-- get quantities that count superseded copies of edited orders.
--
-- Same one-line correction applied to v2: read v_d2c_current_order_items
-- instead. Everything else about the function is untouched.

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
    from public.v_d2c_current_order_items oi
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
