-- The raws/sub_preps/totals arrays were ordered by kg alone. Ties (there are
-- several) came back in whatever order the planner happened to produce, so two
-- identical runs could return different JSON. That made before/after diffing
-- during data cleanup unreliable -- it cost a false alarm during the self-link
-- fix. Add a name tiebreaker. No values change.
CREATE OR REPLACE FUNCTION public.sim_production_requirements(p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
  with dishes as (
    select sku, dish_name, qty from sim_pack_dish_import where import_date = p_date
  ),
  comp_demand as (
    select c.id as component_id, c.name, c.station,
           sum(case when b.uom = 'g'   then b.grams * d.qty / 1000.0
                    when b.piece_grams is not null then b.grams * b.piece_grams * d.qty / 1000.0
               end) as kg,
           sum(case when b.uom = 'pcs' then b.grams * d.qty end) as pieces,
           max(b.uom) as uom,
           count(*) filter (where b.grams is null) as unknown_grams
    from dishes d
    join sim_dish_bom b on b.sku = d.sku
    join sim_components c on c.id = b.component_id and c.active
    group by c.id, c.name, c.station
  ),
  recursive_needs as (
    with recursive x(recipe_id, kg, depth, path) as (
      select r.id, cd.kg, 1, array[r.id]
      from comp_demand cd join sim_component_recipes r on r.component_id = cd.component_id
      where cd.kg is not null
      union all
      select i.sub_recipe_id, x.kg * i.ratio_per_kg, x.depth + 1, x.path || i.sub_recipe_id
      from x join sim_component_ingredients i on i.recipe_id = x.recipe_id
      where i.sub_recipe_id is not null and i.sub_recipe_id <> i.recipe_id
        and i.ratio_per_kg is not null and x.depth < 5
        and not (i.sub_recipe_id = any (x.path))
    ) select * from x
  ),
  sub_preps as (
    select r.id, r.name, r.prep_type, sum(n.kg) as kg
    from recursive_needs n join sim_component_recipes r on r.id = n.recipe_id
    where n.depth > 1 group by r.id, r.name, r.prep_type
  ),
  raws as (
    select i.name, sum(n.kg * i.ratio_per_kg) as kg
    from recursive_needs n
    join sim_component_ingredients i on i.recipe_id = n.recipe_id
     and (i.sub_recipe_id is null or i.sub_recipe_id = i.recipe_id)
    where i.ratio_per_kg is not null group by i.name
  ),
  totals as (
    select t.recipe_id, r.name, r.prep_type, r.component_id, t.direct_kg, t.nested_kg, t.total_kg
    from sim_recipe_totals(p_date) t
    join sim_component_recipes r on r.id = t.recipe_id
    where t.total_kg > 0
  )
  select jsonb_build_object(
    'date', p_date,
    'meals', coalesce((select sum(qty) from dishes), 0),
    'dishes', coalesce((select count(*) from dishes), 0),
    'components', coalesce((select jsonb_agg(jsonb_build_object(
        'component_id', component_id, 'name', name, 'station', station,
        'kg', round(kg::numeric, 1), 'pieces', pieces, 'uom', uom,
        'unknown_grams', unknown_grams) order by station, name)
      from comp_demand), '[]'::jsonb),
    'sub_preps', coalesce((select jsonb_agg(jsonb_build_object(
        'recipe_id', id, 'name', name, 'prep_type', prep_type, 'kg', round(kg::numeric, 1))
        order by kg desc, name)
      from sub_preps), '[]'::jsonb),
    'raws', coalesce((select jsonb_agg(jsonb_build_object(
        'name', name, 'kg', round(kg::numeric, 2)) order by kg desc, name)
      from raws), '[]'::jsonb),
    'totals', coalesce((select jsonb_agg(jsonb_build_object(
        'recipe_id', recipe_id, 'component_id', component_id, 'name', name,
        'prep_type', prep_type, 'direct_kg', round(direct_kg, 1),
        'nested_kg', round(nested_kg, 1), 'total_kg', round(total_kg, 1))
        order by total_kg desc, name)
      from totals), '[]'::jsonb)
  ) into result;
  return result;
end $function$;
