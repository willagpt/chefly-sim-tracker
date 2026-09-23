-- Tray & pallet ledger for wholesale (Simmer) transit packaging.
-- One append-only event table (deliveries out, returns back) + a single settings row.
-- Balances are computed, never stored: at-partner = sum(delivery trays) - sum(return trays).
-- Seeded with the reconciliation agreed 23 Sep 2026 (PO quantities at 30/30/24 meals per
-- tray, rounded up per line; pallets at 1,080 meals). Unconfirmed return counts are
-- flagged confirmed=false and must be chased to a written count.

create table if not exists public.sim_tray_settings (
  id int primary key default 1 check (id = 1),
  fleet_trays int not null default 3060,
  fleet_pallets int not null default 50,
  meals_per_pallet int not null default 1080,
  email_to text not null default 'D2c.Admin@oakland-international.com',
  email_cc text default 'Kenan.Blakely@oakland-international.com, kaja@eatchefly.com',
  email_from text not null default 'james@eatchefly.com',
  updated_at timestamptz not null default now()
);
alter table public.sim_tray_settings enable row level security;
drop policy if exists sim_tray_settings_select on public.sim_tray_settings;
create policy sim_tray_settings_select on public.sim_tray_settings
  for select using (true);
drop policy if exists sim_tray_settings_write on public.sim_tray_settings;
create policy sim_tray_settings_write on public.sim_tray_settings
  for all using (sim_current_role() = any(array['admin','manager']))
  with check (sim_current_role() = any(array['admin','manager']));
insert into public.sim_tray_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.sim_tray_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  week_start date,
  kind text not null check (kind in ('delivery','return')),
  destination_code text not null default 'OIUK',
  trays int not null check (trays >= 0),
  pallets int check (pallets is null or pallets >= 0),
  meals int check (meals is null or meals >= 0),
  shipment_id uuid references public.sim_ws_shipments(id) on delete set null,
  confirmed boolean not null default false,
  confirmed_by text,
  email_sent_at timestamptz,
  email_to text,
  source text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists sim_tray_events_dest_date
  on public.sim_tray_events (destination_code, event_date);
alter table public.sim_tray_events enable row level security;
drop policy if exists sim_tray_events_select on public.sim_tray_events;
create policy sim_tray_events_select on public.sim_tray_events
  for select using (true);
drop policy if exists sim_tray_events_write on public.sim_tray_events;
create policy sim_tray_events_write on public.sim_tray_events
  for all using (sim_current_role() = any(array['admin','manager']))
  with check (sim_current_role() = any(array['admin','manager']));

-- ---------- Seed: Oakland International (OIUK) deliveries ----------
insert into public.sim_tray_events
  (event_date, week_start, kind, destination_code, trays, pallets, meals, confirmed, confirmed_by, source, note) values
  ('2026-07-02','2026-06-29','delivery','OIUK',735,20,21027,true,'PO','PO WC 29 Jun 2026 (Barbacoa)',null),
  ('2026-07-09','2026-07-06','delivery','OIUK',343,10,9755,true,'PO','PO 8 Jul 2026 revised (Grilled Chicken + S&S)',null),
  ('2026-07-16','2026-07-13','delivery','OIUK',591,16,16863,true,'PO','PO 14 Jul 2026 (Barbacoa)',null),
  ('2026-07-23','2026-07-20','delivery','OIUK',416,11,11856,true,'PO','PO 21 Jul 2026 (GC Power Bowl)','Delivery email confirmed 11 pallets — validates 1,080 meals/pallet'),
  ('2026-07-30','2026-07-27','delivery','OIUK',486,13,13838,true,'PO','PO 29 Jul 2026 (Barbacoa)',null),
  ('2026-08-06','2026-08-03','delivery','OIUK',644,17,18329,true,'PO','PO 5 Aug 2026 (GC Power Bowl)',null),
  ('2026-08-13','2026-08-10','delivery','OIUK',502,14,14330,true,'PO','PO 12 Aug 2026 (Barbacoa)',null),
  ('2026-08-20','2026-08-17','delivery','OIUK',457,13,13052,true,'PO','PO 19 Aug 2026 (GC Power Bowl)',null),
  ('2026-08-27','2026-08-24','delivery','OIUK',338,9,9380,true,'PO','PO 26 Aug 2026 (Brisket Barbacoa)',null),
  ('2026-09-03','2026-08-31','delivery','OIUK',832,22,23521,true,'PO','PO 2 Sep 2026 (supersedes 1 Sep PO — same combined total)',null),
  ('2026-09-10','2026-09-07','delivery','OIUK',793,21,22579,true,'Final-order email (Tom Needham)','No PO saved for week 37; quantities from final-order email / tracker SIMCFOIUK090926',null),
  ('2026-09-17','2026-09-14','delivery','OIUK',689,19,19594,true,'PO','PO 15 Sep 2026 (Brisket Barbacoa)',null),
  ('2026-09-24','2026-09-21','delivery','OIUK',694,19,19763,false,null,'PO 23 Sep 2026 (Brisket Barbacoa)','SCHEDULED for Thu 24 Sep — mark confirmed once shipped');

-- ---------- Seed: Oakland returns ----------
insert into public.sim_tray_events
  (event_date, kind, destination_code, trays, pallets, confirmed, confirmed_by, source, note) values
  ('2026-08-03','return','OIUK',480,4,true,'Ashley Macauley (email 3 Aug)','Van collection','"Loaded 4 pallets back 480"'),
  ('2026-08-07','return','OIUK',1605,null,false,null,'DMC 893 / Rigid KLU','ASSUMED = remaining of 2,085 requested 30 Jul (2,085 - 480). Count never stated — ask Oakland to confirm'),
  ('2026-08-20','return','OIUK',1632,null,false,null,'Trailer with Thursday collection','ASSUMED = 1,632 requested 19 Aug (486+644+502). Received 21 Aug; count never stated — ask Oakland to confirm'),
  ('2026-09-03','return','OIUK',1770,12,true,'Sushila / D2C Admin (email 14 Sep)','DMC 910 trailer','Oakland''s own count: 1,770 trays / 12 pallets. Books say they held 1,627 — possible grey-tray mix-in'),
  ('2026-09-10','return','OIUK',700,null,false,null,'Trailer + blue empty pallets','Oakland said "around 700" (1,504 requested); exact tray and pallet count needed');

-- ---------- Seed: Coolpack Solutions UK (CPUK) deliveries ----------
insert into public.sim_tray_events
  (event_date, week_start, kind, destination_code, trays, pallets, meals, confirmed, confirmed_by, source) values
  ('2026-07-23','2026-07-20','delivery','CPUK',12,1,336,true,'PO','PO 21 Jul 2026'),
  ('2026-07-30','2026-07-27','delivery','CPUK',3,1,75,true,'PO','PO 29 Jul 2026'),
  ('2026-08-06','2026-08-03','delivery','CPUK',65,2,1947,true,'PO','PO 5 Aug 2026'),
  ('2026-08-13','2026-08-10','delivery','CPUK',3,1,79,true,'PO','PO 12 Aug 2026'),
  ('2026-08-20','2026-08-17','delivery','CPUK',118,4,3328,true,'PO','PO 19 Aug 2026'),
  ('2026-08-27','2026-08-24','delivery','CPUK',186,6,5552,true,'PO','PO 26 Aug 2026'),
  ('2026-09-03','2026-08-31','delivery','CPUK',187,6,5596,true,'PO','PO 2 Sep 2026');

-- ---------- Seed: Ireland via Coolpack (IE) deliveries ----------
insert into public.sim_tray_events
  (event_date, week_start, kind, destination_code, trays, pallets, meals, confirmed, confirmed_by, source, note) values
  ('2026-07-02','2026-06-29','delivery','IE',3,1,20,true,'PO','PO WC 29 Jun 2026',null),
  ('2026-07-09','2026-07-06','delivery','IE',3,1,26,true,'PO','PO 8 Jul 2026 revised',null),
  ('2026-07-16','2026-07-13','delivery','IE',3,1,42,true,'PO','PO 14 Jul 2026',null),
  ('2026-07-23','2026-07-20','delivery','IE',3,1,39,true,'PO','PO 21 Jul 2026',null),
  ('2026-07-30','2026-07-27','delivery','IE',3,1,55,true,'PO','PO 29 Jul 2026',null),
  ('2026-08-06','2026-08-03','delivery','IE',3,1,47,true,'PO','PO 5 Aug 2026',null),
  ('2026-08-13','2026-08-10','delivery','IE',3,1,42,true,'PO','PO 12 Aug 2026',null),
  ('2026-08-20','2026-08-17','delivery','IE',4,1,42,true,'PO','PO 19 Aug 2026',null),
  ('2026-08-27','2026-08-24','delivery','IE',4,1,74,true,'PO','PO 26 Aug 2026',null),
  ('2026-09-03','2026-08-31','delivery','IE',4,1,86,true,'PO','PO 2 Sep 2026',null),
  ('2026-09-10','2026-09-07','delivery','IE',5,1,131,true,'Final-order email','No PO saved for week 37',null),
  ('2026-09-17','2026-09-14','delivery','IE',7,1,159,true,'PO','PO 15 Sep 2026',null),
  ('2026-09-24','2026-09-21','delivery','IE',7,1,161,false,null,'PO 23 Sep 2026','SCHEDULED — mark confirmed once shipped');
