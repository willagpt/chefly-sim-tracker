-- Menu R&D Hub — Phase 1 (internal only), per docs/menu-rd-hub-prd.md.
--
-- One recipe, iterated as versions, ingredient lines costed live from the
-- existing `ingredients` table (no MarketMan/Nutritics re-entry at this
-- stage). Draft/iteration data lives entirely in these new sim_dev_* tables
-- -- it never touches sub_recipes/finished_products, so in-progress work
-- can't leak into what the production floor is actually running. Promotion
-- into production tables is a deliberate later step (Phase 4), not part of
-- this migration.
--
-- Costing design note: to avoid repeating the gr/kg unit-mixing bug fixed
-- elsewhere in this project today, an ingredient line does NOT carry its own
-- freely-editable unit. Its uom is always copied from the ingredient's own
-- `ingredients.uom` at the moment it's added (recorded for display/audit),
-- and cost is qty * ingredients.price_per_unit in that same unit. There is
-- no unit conversion in this pipeline because there's no unit mismatch to
-- convert -- a line's quantity is always "how many of the ingredient's own
-- priced unit."

create table if not exists public.sim_dev_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  notes text,
  current_version_id uuid,
  locked_version_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sim_dev_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.sim_dev_recipes(id) on delete cascade,
  version_no int not null,
  status text not null default 'draft'
    check (status in ('draft','sent_for_tasting','client_feedback','approved_locked')),
  notes text,
  nutrition_json jsonb,
  nutrition_source text not null default 'pending'
    check (nutrition_source in ('pending','manual','nutritics_api')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  unique (recipe_id, version_no)
);

alter table public.sim_dev_recipes
  add constraint sim_dev_recipes_current_version_fk
    foreign key (current_version_id) references public.sim_dev_recipe_versions(id),
  add constraint sim_dev_recipes_locked_version_fk
    foreign key (locked_version_id) references public.sim_dev_recipe_versions(id);

create table if not exists public.sim_dev_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.sim_dev_recipe_versions(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  qty numeric not null check (qty > 0),
  uom text, -- snapshot of ingredients.uom at add-time; not independently editable
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sim_dev_recipe_versions_recipe_idx on public.sim_dev_recipe_versions(recipe_id);
create index if not exists sim_dev_recipe_ingredients_version_idx on public.sim_dev_recipe_ingredients(version_id);

-- ---- RLS: same manager/admin write, open read pattern as sim_products/sim_task_catalog ----
alter table public.sim_dev_recipes enable row level security;
alter table public.sim_dev_recipe_versions enable row level security;
alter table public.sim_dev_recipe_ingredients enable row level security;

create policy sim_dev_recipes_select on public.sim_dev_recipes for select using (true);
create policy sim_dev_recipes_write on public.sim_dev_recipes for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_dev_recipe_versions_select on public.sim_dev_recipe_versions for select using (true);
create policy sim_dev_recipe_versions_write on public.sim_dev_recipe_versions for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_dev_recipe_ingredients_select on public.sim_dev_recipe_ingredients for select using (true);
create policy sim_dev_recipe_ingredients_write on public.sim_dev_recipe_ingredients for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

-- ---- Live cost rollup per version ----
create or replace view public.sim_dev_recipe_version_costs as
select dri.version_id,
       sum(dri.qty * coalesce(i.price_per_unit,0)) as total_cost,
       count(*) as ingredient_lines,
       count(*) filter (where i.price_per_unit is null) as lines_missing_price
from public.sim_dev_recipe_ingredients dri
join public.ingredients i on i.id = dri.ingredient_id
group by dri.version_id;

-- ---- Create the next version of a recipe (atomic version numbering) ----
create or replace function public.sim_dev_add_version(p_recipe_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_next_no int;
  v_version_id uuid;
begin
  if sim_current_role() not in ('admin','manager') then
    raise exception 'Not authorised';
  end if;

  select coalesce(max(version_no),0) + 1 into v_next_no
  from public.sim_dev_recipe_versions where recipe_id = p_recipe_id;

  insert into public.sim_dev_recipe_versions (recipe_id, version_no, notes, created_by)
  values (p_recipe_id, v_next_no, p_notes, auth.uid())
  returning id into v_version_id;

  update public.sim_dev_recipes
    set current_version_id = v_version_id, updated_at = now()
    where id = p_recipe_id;

  return v_version_id;
end;
$function$;

-- ---- Advance a version's status (draft -> sent_for_tasting -> client_feedback) ----
create or replace function public.sim_dev_set_version_status(p_version_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if sim_current_role() not in ('admin','manager') then
    raise exception 'Not authorised';
  end if;
  if p_status not in ('draft','sent_for_tasting','client_feedback') then
    raise exception 'Use sim_dev_lock_version() to approve and lock a version';
  end if;
  update public.sim_dev_recipe_versions set status = p_status where id = p_version_id;
end;
$function$;

-- ---- Approve & lock a version. Freezes it; does NOT yet write to
-- finished_products/sub_recipes -- that promotion is Phase 4, deliberately
-- separate so this migration can't accidentally touch production data. ----
create or replace function public.sim_dev_lock_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recipe_id uuid;
begin
  if sim_current_role() not in ('admin','manager') then
    raise exception 'Not authorised';
  end if;

  select recipe_id into v_recipe_id from public.sim_dev_recipe_versions where id = p_version_id;
  if v_recipe_id is null then
    raise exception 'Version not found';
  end if;

  update public.sim_dev_recipe_versions
    set status = 'approved_locked', locked_at = now()
    where id = p_version_id;

  update public.sim_dev_recipes
    set locked_version_id = p_version_id, updated_at = now()
    where id = v_recipe_id;
end;
$function$;

comment on table public.sim_dev_recipes is
  'Menu R&D Hub (Phase 1): client/internal dish development. Draft-only -- never written to sub_recipes/finished_products until an explicit future promotion step. See docs/menu-rd-hub-prd.md.';
