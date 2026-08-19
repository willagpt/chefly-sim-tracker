-- Wholesale shipments: one record per PO / consignment, plus the destinations
-- they go to. Everything on the paperwork (delivery note, packing list, pallet
-- labels) is derived from these three tables -- nothing is typed twice.

create table if not exists sim_ws_destinations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,              -- goes into the PO number: SIMCF<code><ddmmyy>
  name text not null,                     -- 'Oaklands International'
  address_line text,                      -- 'Bardon Hill, Coalville LE67 1TB'
  attn text,                              -- 'Maryam Ghafoor'
  sub_label text,                         -- 'Ireland order · collected by Coolpack Solutions'
  mode text not null default 'delivery'   -- delivery | collection
    check (mode in ('delivery','collection')),
  pallet_labels boolean not null default true,
  tray_tracking boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sim_ws_shipments (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  destination_id uuid not null references sim_ws_destinations(id),
  week_start date,
  product_name text not null,
  dispatch_date date not null,
  trays_per_pallet int not null default 45 check (trays_per_pallet > 0),
  status text not null default 'draft'
    check (status in ('draft','confirmed','dispatched','cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sim_ws_shipments_week_idx on sim_ws_shipments(week_start);
create index if not exists sim_ws_shipments_dispatch_idx on sim_ws_shipments(dispatch_date);

create table if not exists sim_ws_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references sim_ws_shipments(id) on delete cascade,
  config text not null,                   -- Standard | Large | Lean
  meals int not null default 0 check (meals >= 0),
  tray_capacity int not null check (tray_capacity > 0),  -- snapshotted: 30/30/24
  sort_order int not null default 0,
  unique (shipment_id, config)
);

create index if not exists sim_ws_shipment_lines_ship_idx on sim_ws_shipment_lines(shipment_id);

-- Derived quantities, in one place so the app, the paperwork and any report
-- can never disagree. Trays round up per line; pallets hold trays_per_pallet
-- trays of a single configuration, so a part pallet still ships as a pallet.
create or replace view v_ws_shipment_line_calc as
select
  l.id,
  l.shipment_id,
  l.config,
  l.meals,
  l.tray_capacity,
  l.sort_order,
  s.trays_per_pallet,
  ceil(l.meals::numeric / l.tray_capacity)::int as trays,
  ceil(ceil(l.meals::numeric / l.tray_capacity) / s.trays_per_pallet)::int as pallets,
  floor(ceil(l.meals::numeric / l.tray_capacity) / s.trays_per_pallet)::int as full_pallets,
  (l.tray_capacity * s.trays_per_pallet) as meals_per_full_pallet,
  (l.meals - floor(ceil(l.meals::numeric / l.tray_capacity) / s.trays_per_pallet)::int
    * l.tray_capacity * s.trays_per_pallet) as last_pallet_meals
from sim_ws_shipment_lines l
join sim_ws_shipments s on s.id = l.shipment_id;

create or replace view v_ws_shipment_totals as
select
  s.id as shipment_id,
  coalesce(sum(c.meals), 0)::int   as meals,
  coalesce(sum(c.trays), 0)::int   as trays,
  coalesce(sum(c.pallets), 0)::int as pallets,
  count(c.id) filter (where c.meals > 0)::int as configurations
from sim_ws_shipments s
left join v_ws_shipment_line_calc c on c.shipment_id = s.id
group by s.id;

alter table sim_ws_destinations   enable row level security;
alter table sim_ws_shipments      enable row level security;
alter table sim_ws_shipment_lines enable row level security;

drop policy if exists sim_ws_destinations_select on sim_ws_destinations;
create policy sim_ws_destinations_select on sim_ws_destinations for select using (true);
drop policy if exists sim_ws_destinations_write on sim_ws_destinations;
create policy sim_ws_destinations_write on sim_ws_destinations for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

drop policy if exists sim_ws_shipments_select on sim_ws_shipments;
create policy sim_ws_shipments_select on sim_ws_shipments for select using (true);
drop policy if exists sim_ws_shipments_write on sim_ws_shipments;
create policy sim_ws_shipments_write on sim_ws_shipments for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

drop policy if exists sim_ws_shipment_lines_select on sim_ws_shipment_lines;
create policy sim_ws_shipment_lines_select on sim_ws_shipment_lines for select using (true);
drop policy if exists sim_ws_shipment_lines_write on sim_ws_shipment_lines;
create policy sim_ws_shipment_lines_write on sim_ws_shipment_lines for all
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));

insert into sim_ws_destinations (code, name, address_line, attn, sub_label, mode, pallet_labels, sort_order)
values
  ('OIUK', 'Oaklands International', 'Bardon Hill, Coalville LE67 1TB', 'Maryam Ghafoor', null, 'delivery', true, 1),
  ('CPUK', 'Coolpack Solutions', null, null, 'United Kingdom · pack at Coolpack Solutions', 'delivery', false, 2),
  ('IE',   'Coolpack Solutions', null, null, 'Ireland order · collected by Coolpack Solutions', 'collection', false, 3)
on conflict (code) do nothing;
