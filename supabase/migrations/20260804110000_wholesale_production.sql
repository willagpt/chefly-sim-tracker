-- WHOLESALE (Simmer) production module.
-- One meal per week (alternating: Mexican Brisket Bowl / Japanese Chicken &
-- Butternut Squash), each in up to three variants (Standard / Large / Lean).
-- The team sets per-variant weekly targets; the app derives the pre-production
-- build-up plan (kg + batches per component), tracks component stock built
-- ahead (frozen salsa/beans, chilled brisket/chicken...), and runs the packing
-- day in lots of 750 portions (trays come in boxes of 750).
--
-- Tables are prefixed sim_ws_ and deliberately separate from the D2C cook
-- queue (sim_components / sim_dish_bom) so wholesale planning cannot disturb
-- the daily Chefly production flow.
--
-- NOTE: this migration was applied to the live database on 2026-08-04 via the
-- Supabase MCP (migration name: wholesale_production). This file is the
-- versioned record.

-- ---- meals & variants ----------------------------------------------------
create table if not exists public.sim_ws_meals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  client      text not null default 'Simmer',
  active      boolean not null default true,       -- meal on/off switch
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
comment on table public.sim_ws_meals is 'Wholesale meal lines (e.g. Mexican Brisket Bowl). active = on/off switch for upcoming menu changes.';

create table if not exists public.sim_ws_variants (
  id          uuid primary key default gen_random_uuid(),
  meal_id     uuid not null references public.sim_ws_meals(id) on delete cascade,
  name        text not null,                        -- Standard / Large / Lean
  portion_g   numeric,                              -- finished portion weight
  active      boolean not null default true,
  sort_order  integer not null default 0,
  unique (meal_id, name)
);

-- ---- component catalogue --------------------------------------------------
create table if not exists public.sim_ws_components (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  kind        text not null default 'prep' check (kind in ('prep','bought','raw')),
  -- prep  = made in the kitchen (appears in the pre-prep plan)
  -- bought = bought-in, portioned as-is (seeds, salt)
  -- raw   = raw-material stock line only (e.g. frozen peppers) — not in any BOM
  stage       text not null default 'day_of'
              check (stage in ('build_ahead_frozen','build_ahead_chilled','day_before','day_of')),
  batch_kg    numeric,                              -- one batch/vessel-load yield
  storage     text,                                 -- Freezer / Fridge / Ambient
  raw_factor  numeric,                              -- raw kg needed per 1 kg finished (cook yield)
  prep_note   text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
comment on column public.sim_ws_components.raw_factor is 'Raw kg per 1 kg cooked/finished — e.g. brisket 1.25 (80% cook yield).';

-- ---- per-portion BOM (leaf components, grams) ------------------------------
create table if not exists public.sim_ws_bom (
  id           uuid primary key default gen_random_uuid(),
  variant_id   uuid not null references public.sim_ws_variants(id) on delete cascade,
  component_id uuid not null references public.sim_ws_components(id),
  grams        numeric not null,
  unique (variant_id, component_id)
);

-- ---- weekly targets --------------------------------------------------------
create table if not exists public.sim_ws_weeks (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null unique,                 -- Monday
  status      text not null default 'planning' check (status in ('planning','locked','done')),
  notes       text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.sim_ws_week_lines (
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid not null references public.sim_ws_weeks(id) on delete cascade,
  variant_id  uuid not null references public.sim_ws_variants(id),
  target_qty  integer not null default 0,
  unique (week_id, variant_id)
);

-- ---- pre-production stock ledger -------------------------------------------
create table if not exists public.sim_ws_stock_moves (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.sim_ws_components(id),
  move_date    date not null default current_date,
  qty_kg       numeric not null,                    -- + build / - use (sign carried by qty)
  kind         text not null default 'build' check (kind in ('build','use','adjust','waste')),
  lot_code     text,
  note         text,
  week_id      uuid references public.sim_ws_weeks(id) on delete set null,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
comment on table public.sim_ws_stock_moves is 'Pre-production stock ledger. Stock on hand = sum(qty_kg) per component. build/adjust positive, use/waste negative (enforced by trigger).';

-- normalise signs so on-hand is always a plain sum
create or replace function public.sim_ws_stock_sign() returns trigger
language plpgsql as $$
begin
  if new.kind in ('use','waste') then new.qty_kg := -abs(new.qty_kg);
  elsif new.kind = 'build' then new.qty_kg := abs(new.qty_kg);
  end if;  -- 'adjust' keeps its sign
  return new;
end $$;
drop trigger if exists sim_ws_stock_sign_t on public.sim_ws_stock_moves;
create trigger sim_ws_stock_sign_t before insert or update on public.sim_ws_stock_moves
  for each row execute function public.sim_ws_stock_sign();

-- ---- packing day: 750-portion lots -----------------------------------------
create table if not exists public.sim_ws_pack_lots (
  id          uuid primary key default gen_random_uuid(),
  week_id     uuid not null references public.sim_ws_weeks(id) on delete cascade,
  variant_id  uuid not null references public.sim_ws_variants(id),
  lot_no      integer not null,
  lot_size    integer not null default 750,         -- one box of trays
  team        text,                                 -- 'A' / 'B'
  status      text not null default 'pending' check (status in ('pending','in_progress','done')),
  started_at  timestamptz,
  finished_at timestamptz,
  packed_qty  integer,                              -- actual portions packed (defaults lot_size)
  notes       text,
  created_at  timestamptz not null default now(),
  unique (week_id, variant_id, lot_no)
);

-- per-lot ingredient issue/return — the overportioning check
create table if not exists public.sim_ws_lot_usage (
  id           uuid primary key default gen_random_uuid(),
  lot_id       uuid not null references public.sim_ws_pack_lots(id) on delete cascade,
  component_id uuid not null references public.sim_ws_components(id),
  issued_kg    numeric,
  returned_kg  numeric,
  note         text,
  updated_at   timestamptz not null default now(),
  unique (lot_id, component_id)
);
comment on table public.sim_ws_lot_usage is 'Kg issued to the line (and returned) per 750-lot per component. Expected = grams x lot_size. Used vs expected exposes overportioning.';

-- ---- RLS -------------------------------------------------------------------
alter table public.sim_ws_meals       enable row level security;
alter table public.sim_ws_variants    enable row level security;
alter table public.sim_ws_components  enable row level security;
alter table public.sim_ws_bom         enable row level security;
alter table public.sim_ws_weeks      enable row level security;
alter table public.sim_ws_week_lines  enable row level security;
alter table public.sim_ws_stock_moves enable row level security;
alter table public.sim_ws_pack_lots   enable row level security;
alter table public.sim_ws_lot_usage   enable row level security;

-- read: any signed-in user; setup/plan writes: manager+; floor writes (stock,
-- lots, usage): any signed-in user, deletes manager+.
create policy sim_ws_meals_select on public.sim_ws_meals for select using (true);
create policy sim_ws_meals_write  on public.sim_ws_meals for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_variants_select on public.sim_ws_variants for select using (true);
create policy sim_ws_variants_write  on public.sim_ws_variants for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_components_select on public.sim_ws_components for select using (true);
create policy sim_ws_components_write  on public.sim_ws_components for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_bom_select on public.sim_ws_bom for select using (true);
create policy sim_ws_bom_write  on public.sim_ws_bom for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_weeks_select on public.sim_ws_weeks for select using (true);
create policy sim_ws_weeks_write  on public.sim_ws_weeks for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_week_lines_select on public.sim_ws_week_lines for select using (true);
create policy sim_ws_week_lines_write  on public.sim_ws_week_lines for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_stock_select on public.sim_ws_stock_moves for select using (true);
create policy sim_ws_stock_insert on public.sim_ws_stock_moves for insert with check (auth.uid() is not null);
create policy sim_ws_stock_update on public.sim_ws_stock_moves for update
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));
create policy sim_ws_stock_delete on public.sim_ws_stock_moves for delete
  using (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_lots_select on public.sim_ws_pack_lots for select using (true);
create policy sim_ws_lots_insert on public.sim_ws_pack_lots for insert with check (auth.uid() is not null);
create policy sim_ws_lots_update on public.sim_ws_pack_lots for update
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy sim_ws_lots_delete on public.sim_ws_pack_lots for delete
  using (sim_current_role() = any (array['admin','manager']));

create policy sim_ws_usage_select on public.sim_ws_lot_usage for select using (true);
create policy sim_ws_usage_write  on public.sim_ws_lot_usage for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---- seed: the two Simmer meals, from the approved recipe workbook ---------
do $$
declare
  m_beef uuid; m_chk uuid;
  v_bs uuid; v_bl uuid; v_bn uuid;    -- brisket Standard/Large/Lean
  v_cs uuid; v_cl uuid; v_cn uuid;    -- chicken Standard/Large/Lean
  c_brisket uuid; c_rice uuid; c_beans uuid; c_fajita uuid; c_salsa uuid; c_cauli uuid;
  c_chicken uuid; c_squash uuid; c_kale uuid; c_barley uuid; c_dress uuid; c_seeds uuid; c_salt uuid;
begin
  if exists (select 1 from public.sim_ws_meals) then return; end if;

  insert into public.sim_ws_meals (name, client, sort_order) values
    ('Mexican Brisket Bowl','Simmer',1) returning id into m_beef;
  insert into public.sim_ws_meals (name, client, sort_order) values
    ('Japanese Chicken & Butternut Squash','Simmer',2) returning id into m_chk;

  insert into public.sim_ws_variants (meal_id,name,portion_g,sort_order) values (m_beef,'Standard',400,1) returning id into v_bs;
  insert into public.sim_ws_variants (meal_id,name,portion_g,sort_order) values (m_beef,'Large',570,2)    returning id into v_bl;
  insert into public.sim_ws_variants (meal_id,name,portion_g,sort_order) values (m_beef,'Lean',400,3)     returning id into v_bn;
  insert into public.sim_ws_variants (meal_id,name,portion_g,sort_order) values (m_chk,'Standard',392,1)  returning id into v_cs;
  insert into public.sim_ws_variants (meal_id,name,portion_g,sort_order) values (m_chk,'Large',504,2)     returning id into v_cl;
  insert into public.sim_ws_variants (meal_id,name,portion_g,sort_order) values (m_chk,'Lean',362,3)      returning id into v_cn;

  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,raw_factor,prep_note,sort_order) values
    ('Brisket, Mexican (cooked)','prep','build_ahead_chilled',80,'Fridge',1.25,
     'Rub, bar-mark, sous vide in tanks (3 x 80 kg). ~80% cook yield — raw = 125% of cooked. Cook & chill ahead.',1)
     returning id into c_brisket;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,raw_factor,prep_note,sort_order) values
    ('Japanese Chicken (cooked)','prep','build_ahead_chilled',200,'Fridge',1.22,
     'Marinate + vac pack, cook 69°C for 2 h, grill (calibrated breast 140–170 g). ~82% yield. Cook & chill ahead.',2)
     returning id into c_chicken;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,prep_note,sort_order) values
    ('Smoky Salsa','prep','build_ahead_frozen',200,'Freezer',
     '200 kg bratt-pan batch. Vac pack 2 kg bags (300x300 mm, pressure 10), freeze to build stock.',3)
     returning id into c_salsa;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,prep_note,sort_order) values
    ('Black Beans, Cooked','prep','build_ahead_frozen',109,'Freezer',
     'Frima 1.5 h, drain + cold rinse. 50 kg dried beans per 109 kg batch. Freeze to build stock.',4)
     returning id into c_beans;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,prep_note,sort_order) values
    ('Lime & Coriander Rice, Cooked','prep','day_of',88,'Fridge',
     'Steam 40 min at 100°C. 4.4 kg per tray, 88 kg per oven load (20 trays). Made on the day.',5)
     returning id into c_rice;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,prep_note,sort_order) values
    ('Fajita Peppers & Onions','prep','day_of',33.3,'Fridge',
     'Bratt pan, 33.3 kg batches. 90% peppers — mix of fresh + frozen (hold frozen pepper stock; see Raw stock).',6)
     returning id into c_fajita;
  insert into public.sim_ws_components (name,kind,stage,storage,raw_factor,prep_note,sort_order) values
    ('Cauliflower Rice, Steamed','prep','day_of','Fridge',1.10,
     'IQF, 1.5 kg per perforated tray, steam 12 min at 100°C. CHILL IMMEDIATELY.',7)
     returning id into c_cauli;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,prep_note,sort_order) values
    ('Pearl Barley, Cooked','prep','day_before',133,'Fridge',
     '50.5 kg dry + water per 133 kg batch. Can start the day before. Soft chill.',8)
     returning id into c_barley;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,raw_factor,prep_note,sort_order) values
    ('Roasted Butternut Squash','prep','day_of',36.4,'Fridge',1.65,
     'Robot coupe, spread thin, Butternut Squash Programme. 60 kg raw -> 36.4 kg roasted (165% raw).',9)
     returning id into c_squash;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,raw_factor,prep_note,sort_order) values
    ('Kale, Steamed','prep','day_of',60,'Fridge',1.10,
     'IQF, max 1.5 kg per perforated tray, steam 8 min at 100°C. Done on the day.',10)
     returning id into c_kale;
  insert into public.sim_ws_components (name,kind,stage,batch_kg,storage,prep_note,sort_order) values
    ('Lemon Tahini & Olive Oil Dressing','prep','day_of',12,'Fridge',
     'Whisk/mix 1 min high speed. Usually made on the day (can be made ahead).',11)
     returning id into c_dress;
  insert into public.sim_ws_components (name,kind,stage,storage,prep_note,sort_order) values
    ('Sunflower Seeds','bought','day_of','Ambient','Bought in — portioned as-is.',12)
     returning id into c_seeds;
  insert into public.sim_ws_components (name,kind,stage,storage,prep_note,sort_order) values
    ('Salt (in veg base)','bought','day_of','Ambient','Seasoning within the squash/kale/barley base (0.5%).',13)
     returning id into c_salt;
  insert into public.sim_ws_components (name,kind,stage,storage,prep_note,sort_order) values
    ('Mixed Peppers IQF (raw stock)','raw','day_of','Freezer',
     'Raw-material stock line: frozen peppers held for Fajita Peppers & Onions (~90% of its cooked weight, mixed with fresh).',20);

  -- Mexican Brisket Bowl — Standard 400 g (rice & beans blend split 50/50)
  insert into public.sim_ws_bom (variant_id,component_id,grams) values
    (v_bs,c_brisket,100),(v_bs,c_rice,90),(v_bs,c_beans,90),(v_bs,c_fajita,60),(v_bs,c_salsa,60),
  -- Large 570 g
    (v_bl,c_brisket,140),(v_bl,c_rice,125),(v_bl,c_beans,125),(v_bl,c_fajita,100),(v_bl,c_salsa,80),
  -- Lean 400 g
    (v_bn,c_brisket,140),(v_bn,c_rice,55),(v_bn,c_beans,55),(v_bn,c_cauli,40),(v_bn,c_fajita,60),(v_bn,c_salsa,50),
  -- Japanese Chicken — Standard 392 g (base 270 g = squash 25% / kale 25% / barley 37.5% / dressing 12% / salt 0.5%)
    (v_cs,c_chicken,120),(v_cs,c_squash,67.5),(v_cs,c_kale,67.5),(v_cs,c_barley,101.25),(v_cs,c_dress,32.4),(v_cs,c_salt,1.35),(v_cs,c_seeds,2),
  -- Large 504 g (base 350 g)
    (v_cl,c_chicken,150),(v_cl,c_squash,87.5),(v_cl,c_kale,87.5),(v_cl,c_barley,131.25),(v_cl,c_dress,42),(v_cl,c_salt,1.75),(v_cl,c_seeds,4),
  -- Lean 362 g (lean base 230 g = squash 25 / kale 25 / barley 18.75 / cauli 18.75 / dressing 12 / salt 0.5)
    (v_cn,c_chicken,130),(v_cn,c_squash,57.5),(v_cn,c_kale,57.5),(v_cn,c_barley,43.125),(v_cn,c_cauli,43.125),(v_cn,c_dress,27.6),(v_cn,c_salt,1.15),(v_cn,c_seeds,2);
end $$;
