create table if not exists public.sim_method_reviews (
  recipe_id     uuid primary key references public.sim_component_recipes(id) on delete cascade,
  verdict       text,
  method_text   text,
  note          text,
  reviewed_by   text,
  reviewed_at   timestamptz default now(),
  actioned      boolean not null default false,
  actioned_note text,
  actioned_at   timestamptz
);
alter table public.sim_method_reviews enable row level security;

-- Serves the review board and records answers. Unlike the QA board, the recipe list is
-- built live from the database on every load -- the old board was a static JSON snapshot
-- and went stale the moment anything was fixed.
create or replace function public.sim_public_methods(
  p_token text,
  p_action text default 'state',
  p_recipe_id uuid default null,
  p_verdict text default null,
  p_text text default null,
  p_note text default null,
  p_by text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare tok text; result jsonb;
begin
  select value into tok from sim_settings where key = 'qa_token';
  if tok is null or tok = '' or p_token is distinct from tok then
    raise exception 'Invalid token';
  end if;

  if p_action = 'save' then
    if p_recipe_id is null then raise exception 'Bad recipe id'; end if;
    insert into sim_method_reviews(recipe_id, verdict, method_text, note, reviewed_by, reviewed_at)
    values (p_recipe_id,
            left(nullif(btrim(coalesce(p_verdict,'')),''), 60),
            left(nullif(btrim(coalesce(p_text,'')),''), 4000),
            left(nullif(btrim(coalesce(p_note,'')),''), 2000),
            left(nullif(btrim(coalesce(p_by,'')),''), 80), now())
    on conflict (recipe_id) do update set
      verdict     = excluded.verdict,
      method_text = excluded.method_text,
      note        = excluded.note,
      reviewed_by = coalesce(excluded.reviewed_by, sim_method_reviews.reviewed_by),
      reviewed_at = now();
  end if;

  with t as (select recipe_id, total_kg from sim_recipe_totals(
               (select max(import_date) from sim_pack_dish_import))
             where total_kg > 0),
  -- every ingredient name in the book, used as a food vocabulary
  lex as (select distinct lower(btrim(name)) as w from sim_component_ingredients
          where length(btrim(name)) between 5 and 20 and name !~ '[0-9(]'
            and lower(btrim(name)) not in ('water','salt','pepper','olive oil','sunflower oil',
                'rapeseed oil','pomace oil','black pepper','chicken','sugar','honey','butter')),
  rec as (
    select r.id, r.name, c.station, round(t.total_kg,1) as kg, r.prep_type,
           coalesce(r.method,'[]'::jsonb) as method,
           lower(array_to_string(array(select jsonb_array_elements_text(r.method)),' ')) as m,
           (select jsonb_agg(jsonb_build_object('n', i.name, 'r', i.ratio_per_kg) order by i.sort_order)
              from sim_component_ingredients i where i.recipe_id = r.id) as ings,
           (select string_agg(lower(btrim(i.name)),' ') from sim_component_ingredients i where i.recipe_id=r.id) as ingtxt
    from t join sim_component_recipes r on r.id = t.recipe_id and r.active
    left join sim_components c on c.id = r.component_id)
  select jsonb_build_object(
    'date', (select max(import_date) from sim_pack_dish_import),
    'recipes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rec.id, 'name', rec.name, 'station', coalesce(rec.station,'Sub-preparation'),
        'kg', rec.kg, 'prep_type', rec.prep_type,
        'ingredients', coalesce(rec.ings,'[]'::jsonb),
        'method', rec.method,
        'boilerplate', (position('divide marinade equally' in rec.m) > 0),
        'foreign', coalesce((select jsonb_agg(distinct lex.w) from lex
                             where position(lex.w in rec.m) > 0
                               and position(lex.w in coalesce(rec.ingtxt,'')) = 0), '[]'::jsonb))
      order by rec.kg desc) from rec), '[]'::jsonb),
    'reviews', coalesce((select jsonb_object_agg(recipe_id::text, jsonb_build_object(
        'verdict', verdict, 'method_text', method_text, 'note', note,
        'by', reviewed_by, 'at', reviewed_at, 'actioned', actioned))
      from sim_method_reviews), '{}'::jsonb)
  ) into result;
  return result;
end $function$;

grant execute on function public.sim_public_methods(text,text,uuid,text,text,text,text) to anon, authenticated;
