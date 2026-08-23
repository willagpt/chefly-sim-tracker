-- Sunday prep station ("Sunday Simmereats") + correct multi-level requirement totals.
--
-- WHY THIS EXISTS
-- ---------------
-- The old-style Google production workbook has a "Sunday SIM Sheet" tab: the grains,
-- rices and pulses (plus the week's fish) that get cooked on Sunday for the Monday run.
-- It sits alongside SIM BRATT PANS / SIM MIXES / SIM OVEN / MEAT TEAM and is driven by
-- exactly the same imported dish list -- it is just a different slice of it, made a day
-- earlier. This migration gives the app the same slice.
--
-- Two things had to be fixed for that slice to be correct:
--
-- 1. DIRECT vs NESTED DEMAND WERE REPORTED SEPARATELY.
--    sim_production_requirements returns a recipe's *component* demand under
--    `components` (level 1) and its demand-as-an-ingredient-of-another-recipe under
--    `sub_preps` (level >1). Nothing added the two together. So "Lighter Mash" read
--    8.5 kg on the Bratt Pans list while the workbook said 23.4 kg -- the missing
--    14.4 kg was sitting further down the modal under Sub-preparations, because Cheesy
--    Mash is *made from* Lighter Mash. Both numbers were right; neither was the number
--    the chef needs, which is the total to actually cook.
--    Most of the Sunday grains are second-level (Black Quinoa comes from the Basmati &
--    Black Quinoa mix, Pearl Barley from the Butternut/Kale mix, Black Rice from the
--    risotto), so without the total the Sunday sheet would read near-zero.
--    -> v2 adds a `totals` array: direct + nested + total per recipe.
--
-- 2. SELF-REFERENCING INGREDIENT LINKS.
--    36 recipes carry an ingredient line whose sub_recipe_id points at the recipe's own
--    id (the importer matched on name, so "Basmati Rice PS" gained an ingredient
--    "Basmati Rice" linked to itself; same for Penne, Farfalle, Orzo, Tofu, Edamame,
--    Kale IQF, Broccoli, Fennel, Peas and 27 others).
--    The recursion's cycle guard stops these looping, so nothing crashed -- but the
--    `raws` CTE only counts lines where sub_recipe_id IS NULL, so every one of those
--    36 headline raw ingredients was silently missing from the raw-material totals.
--    That is the list used to check what to order.
--    -> v2 treats a self-link as a raw line. The underlying rows are NOT mutated here;
--       the data cleanup is proposed separately so it can be reviewed on its own.
--
-- Not fixed here (data, not logic -- listed so they are not mistaken for code bugs):
--   * 14 dishes on the 2026-08-26 list (61 meals) have no sim_dish_bom rows at all,
--     so they contribute nothing to any requirement. Biggest is SKU 69 "Japanese
--     Chicken Breast x2" at 31 meals.
--   * Recipe "Black Daal Makhani" is not linked to the "Black Dahl" component, so the
--     whole chain beneath it -- including Black Lentils, a Sunday item -- reads zero.
--   * Components "Chicken Thigh", "Chicken, chopped", "Cubed Chicken" and "Meatballs"
--     have no recipe attached, which is why they show unlinked on the Meat Team list.

-- ---------------------------------------------------------------- schedule table ----
create table if not exists public.sim_prep_schedule (
  id                uuid primary key default gen_random_uuid(),
  station           text not null default 'Sunday',
  recipe_id         uuid not null references public.sim_component_recipes(id) on delete cascade,
  sort_order        int  not null default 0,
  display_name      text,          -- plain name for the sheet, overriding the importer's
                                   -- suffixed recipe name ("Basmati Rice PS" -> "Basmati Rice")
  -- presentation: how the floor counts this item, mirroring the workbook's UNITS column
  unit_label        text,          -- 'TRAYS' | 'BOXES'
  kg_per_unit       numeric,       -- e.g. 4.2 kg of cooked rice per gastro tray
  portions_per_unit numeric,       -- e.g. 15 salmon portions per tray, 40 cod per box
  source_note       text,          -- 'MON' | 'FRI' | 'FROZEN' -- what the line feeds / when it lands
  batch_note        text,          -- the per-tray recipe from the sheet's comments column
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (station, recipe_id)
);

create index if not exists sim_prep_schedule_station_idx
  on public.sim_prep_schedule(station) where active;

alter table public.sim_prep_schedule enable row level security;

create policy sim_prep_schedule_sel on public.sim_prep_schedule
  for select using (true);
create policy sim_prep_schedule_wr on public.sim_prep_schedule
  for all
  using (sim_current_role() = any (array['manager','admin']))
  with check (sim_current_role() = any (array['manager','admin']));

-- ------------------------------------------------------------------- seed: Sunday ----
-- Seeded by recipe NAME so this migration is reproducible against a fresh import.
-- Order and notes follow the workbook's "Sunday  SIM Sheet" tab, jobs 1-12.
insert into public.sim_prep_schedule
  (station, recipe_id, sort_order, unit_label, kg_per_unit, portions_per_unit, source_note, batch_note)
select 'Sunday', r.id, s.sort_order, s.unit_label, s.kg_per_unit, s.portions_per_unit, s.source_note, s.batch_note
from (values
  ('Black Lentils Cooked C',   1, null::text,  null::numeric, null::numeric, 'MON',    null::text),
  ('Wild & Basmati Rice PS',   2, 'TRAYS',     4.2,           null,          'MON',    '1950g rice + 50g wild rice + 2 tsp salt + 2200g water per tray'),
  ('White Quinoa Cooked',      3, null,        null,          null,          'MON',    'Double the water per tray'),
  ('Black Beans Cooked PS',    4, null,        null,          null,          'FROZEN', null),
  ('Pearl Barley Cooked PS',   5, null,        null,          null,          'MON',    null),
  ('Basmati Rice PS',          6, 'TRAYS',     4.2,           null,          'MON',    '2000g rice + 2 tsp salt (40g) + 2200g water (1 jug) per tray'),
  ('Rosemary Salmon',          7, 'TRAYS',     null,          15,            'FRI',    '15 portions per tray'),
  ('Teriyaki Salmon',          8, 'TRAYS',     null,          15,            'FRI',    '15 portions per tray'),
  ('Miso Salmon',              9, 'TRAYS',     null,          15,            'FRI',    '15 portions per tray'),
  ('Baked Cod',               10, 'BOXES',     null,          40,            'FRI',    '40 portions per box'),
  ('Panga Fish',              11, 'BOXES',     null,          40,            'FRI',    '40 portions per box'),
  ('Black Rice Cooked PS',    12, 'TRAYS',     4.2,           null,          'MON',    '2kg rice + 2.2kg water per tray'),
  ('Black Quinoa Cooked',     13, null,        null,          null,          'MON',    null),
  ('Biryani Rice PS',         14, 'TRAYS',     4.2,           null,          null,     '2000g rice + 1 tbsp turmeric (20g) + 2 tbsp salt (40g) + 2200g water (1 jug) + a couple of leaves per tray')
) as s(recipe_name, sort_order, unit_label, kg_per_unit, portions_per_unit, source_note, batch_note)
join public.sim_component_recipes r on r.name = s.recipe_name
on conflict (station, recipe_id) do nothing;

-- ------------------------------------------------- shared: total requirement view ----
-- One place that answers "how much of recipe X does day D need, all levels combined".
-- Used by both sim_production_requirements (v2) and sim_prep_station_needs.
create or replace function public.sim_recipe_totals(p_date date)
returns table (recipe_id uuid, direct_kg numeric, nested_kg numeric, total_kg numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  with dishes as (
    select sku, qty from sim_pack_dish_import where import_date = p_date
  ),
  comp_demand as (
    select c.id as component_id, sum(b.grams * d.qty) / 1000.0 as kg
    from dishes d
    join sim_dish_bom b on b.sku = d.sku
    join sim_components c on c.id = b.component_id and c.active
    group by c.id
  ),
  walked as (
    with recursive x(recipe_id, kg, depth, path) as (
      select r.id, cd.kg, 1, array[r.id]
      from comp_demand cd
      join sim_component_recipes r on r.component_id = cd.component_id
      where cd.kg is not null
      union all
      select i.sub_recipe_id, x.kg * i.ratio_per_kg, x.depth + 1, x.path || i.sub_recipe_id
      from x
      join sim_component_ingredients i on i.recipe_id = x.recipe_id
      where i.sub_recipe_id is not null
        and i.sub_recipe_id <> i.recipe_id      -- ignore self-links (see header note 2)
        and i.ratio_per_kg is not null
        and x.depth < 5
        and not (i.sub_recipe_id = any (x.path))
    )
    select * from x
  )
  select w.recipe_id,
         round(coalesce(sum(w.kg) filter (where w.depth = 1), 0)::numeric, 2),
         round(coalesce(sum(w.kg) filter (where w.depth > 1), 0)::numeric, 2),
         round(coalesce(sum(w.kg), 0)::numeric, 2)
  from walked w
  group by w.recipe_id;
$$;

-- --------------------------------------------------- production requirements (v2) ----
create or replace function public.sim_production_requirements(p_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare result jsonb;
begin
  with dishes as (
    select sku, dish_name, qty from sim_pack_dish_import where import_date = p_date
  ),
  comp_demand as (          -- level 0: BOM components in kg
    select c.id as component_id, c.name, c.station,
           sum(b.grams * d.qty) / 1000.0 as kg,
           count(*) filter (where b.grams is null) as unknown_grams
    from dishes d
    join sim_dish_bom b on b.sku = d.sku
    join sim_components c on c.id = b.component_id and c.active
    group by c.id, c.name, c.station
  ),
  recursive_needs as (
    with recursive x(recipe_id, kg, depth, path) as (
      select r.id, cd.kg, 1, array[r.id]
      from comp_demand cd
      join sim_component_recipes r on r.component_id = cd.component_id
      where cd.kg is not null
      union all
      select i.sub_recipe_id, x.kg * i.ratio_per_kg, x.depth + 1, x.path || i.sub_recipe_id
      from x
      join sim_component_ingredients i on i.recipe_id = x.recipe_id
      where i.sub_recipe_id is not null
        and i.sub_recipe_id <> i.recipe_id      -- v2: self-link is not a real link
        and i.ratio_per_kg is not null
        and x.depth < 5
        and not (i.sub_recipe_id = any (x.path))
    )
    select * from x
  ),
  sub_preps as (
    select r.id, r.name, r.prep_type, sum(n.kg) as kg
    from recursive_needs n join sim_component_recipes r on r.id = n.recipe_id
    where n.depth > 1
    group by r.id, r.name, r.prep_type
  ),
  raws as (                 -- v2: a self-linked line counts as raw, so the headline
    select i.name, sum(n.kg * i.ratio_per_kg) as kg   -- ingredient stops disappearing
    from recursive_needs n
    join sim_component_ingredients i
      on i.recipe_id = n.recipe_id
     and (i.sub_recipe_id is null or i.sub_recipe_id = i.recipe_id)
    where i.ratio_per_kg is not null
    group by i.name
  ),
  totals as (
    select t.recipe_id, r.name, r.prep_type, r.component_id,
           t.direct_kg, t.nested_kg, t.total_kg
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
        'kg', round(kg::numeric, 1), 'unknown_grams', unknown_grams) order by station, name)
      from comp_demand), '[]'::jsonb),
    'sub_preps', coalesce((select jsonb_agg(jsonb_build_object(
        'recipe_id', id, 'name', name, 'prep_type', prep_type, 'kg', round(kg::numeric, 1)) order by kg desc)
      from sub_preps), '[]'::jsonb),
    'raws', coalesce((select jsonb_agg(jsonb_build_object(
        'name', name, 'kg', round(kg::numeric, 2)) order by kg desc)
      from raws), '[]'::jsonb),
    -- v2: direct + nested combined, so a line can show the true amount to cook
    'totals', coalesce((select jsonb_agg(jsonb_build_object(
        'recipe_id', recipe_id, 'component_id', component_id, 'name', name,
        'prep_type', prep_type,
        'direct_kg', round(direct_kg, 1), 'nested_kg', round(nested_kg, 1),
        'total_kg', round(total_kg, 1)) order by total_kg desc)
      from totals), '[]'::jsonb)
  ) into result;
  return result;
end $function$;

-- ------------------------------------------------------- Sunday / prep-station RPC ----
-- p_date is the anchor the app already uses -- the shipping/production date the dish
-- list was imported for. The prep date is derived: the Sunday of that production week
-- (i.e. the Sunday on or before it), so a Wednesday-anchored list still points the team
-- at the right Sunday.
create or replace function public.sim_prep_station_needs(
  p_date date default current_date,
  p_station text default 'Sunday'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  result jsonb;
  v_prep_date date;
begin
  v_prep_date := case when extract(dow from p_date) = 0
                      then p_date
                      else (date_trunc('week', p_date::timestamp)::date - 1) end;

  with t as (select * from sim_recipe_totals(p_date)),
  portions as (          -- how many meals contain this component, for the fish lines
    select b.component_id, sum(d.qty) as portions
    from sim_pack_dish_import d
    join sim_dish_bom b on b.sku = d.sku
    where d.import_date = p_date
    group by b.component_id
  ),
  items as (
    select s.sort_order, s.unit_label, s.kg_per_unit, s.portions_per_unit,
           s.source_note, s.batch_note,
           r.id as recipe_id, coalesce(s.display_name, r.name) as name,
           r.name as recipe_name, r.prep_type, r.component_id,
           coalesce(t.total_kg, 0)  as total_kg,
           coalesce(t.direct_kg, 0) as direct_kg,
           coalesce(t.nested_kg, 0) as nested_kg,
           -- only the fish are counted in portions; a grain's "portions" is just how many
           -- meals happen to contain it, which is noise on a cook sheet
           case when s.portions_per_unit is not null then p.portions end as portions,
           case
             when s.portions_per_unit is not null and p.portions is not null
               then round((p.portions / s.portions_per_unit)::numeric, 2)
             when s.kg_per_unit is not null and t.total_kg is not null
               then round((t.total_kg / s.kg_per_unit)::numeric, 2)
           end as units
    from sim_prep_schedule s
    join sim_component_recipes r on r.id = s.recipe_id
    left join t on t.recipe_id = r.id
    left join portions p on p.component_id = r.component_id
    where s.active and s.station = p_station
  )
  select jsonb_build_object(
    'station', p_station,
    'production_date', p_date,
    'prep_date', v_prep_date,
    'meals', coalesce((select sum(qty) from sim_pack_dish_import where import_date = p_date), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'recipe_id', recipe_id, 'component_id', component_id, 'name', name,
        'recipe_name', recipe_name, 'prep_type', prep_type, 'kg', total_kg,
        'direct_kg', direct_kg, 'nested_kg', nested_kg, 'units', units,
        'unit_label', unit_label, 'portions', portions,
        'source_note', source_note, 'batch_note', batch_note)
      order by sort_order) from items), '[]'::jsonb)
  ) into result;
  return result;
end $function$;

grant execute on function public.sim_recipe_totals(date)            to anon, authenticated;
grant execute on function public.sim_prep_station_needs(date, text)  to anon, authenticated;

-- ---------------------------------------------------- display names for the sheet ----
-- The imported recipe names carry importer suffixes ("Basmati Rice PS", "Black Lentils
-- Cooked C"). The Sunday sheet the team knows uses plain names, so allow an override.
alter table public.sim_prep_schedule add column if not exists display_name text;

update public.sim_prep_schedule s set display_name = v.disp
from (values
  ('Black Lentils Cooked C',  'Black Lentils'),
  ('Wild & Basmati Rice PS',  'Wild Basmati Rice'),
  ('White Quinoa Cooked',     'Quinoa'),
  ('Black Beans Cooked PS',   'Black Beans'),
  ('Pearl Barley Cooked PS',  'Pearl Barley'),
  ('Basmati Rice PS',         'Basmati Rice'),
  ('Baked Cod',               'Cod'),
  ('Black Rice Cooked PS',    'Black Rice'),
  ('Black Quinoa Cooked',     'Black Quinoa'),
  ('Biryani Rice PS',         'Biryani Rice')
) as v(recipe_name, disp)
join public.sim_component_recipes r on r.name = v.recipe_name
where s.recipe_id = r.id and s.station = 'Sunday';
