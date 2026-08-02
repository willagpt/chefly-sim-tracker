-- Batch & unit traceability — physical-unit identity, genealogy (splits/merges), and
-- run membership (shared processing) for the chicken line and beyond.
--
-- Design reference: see sim-tracker-batch-traceability-design.md (31 Jul 2026).
-- Deliberately does NOT duplicate the existing CCP / batch-log infrastructure:
--   - sim_task_logs (is_batch, capacity_per_load, equipment_id, start_temp/finish_temp,
--     batch_code) already models a shared processing event (an oven cycle, a chiller
--     stay). A "process run" in the design doc IS a sim_task_logs row.
--   - sim_ccps / sim_ccp_checks already models CCP monitoring against a log_id.
-- What's missing, and what this migration adds, is the physical-unit layer: a QR-labelled
-- identity for a tumbler load / tray / bag, the genealogy between them when one becomes
-- several (or several become one), and which units sat in which existing task-log run.
--
-- Applied to willa-services on 2 Aug 2026 (additive only — no existing tables touched).
-- Written to follow this repo's existing conventions: RLS on every table, the shared
-- sim_log_trace_change() tamper-evident trigger, sim_current_role() for role checks.

-- ---------------------------------------------------------------------------
-- sim_units — one row per physical, individually-labelled thing.
-- ---------------------------------------------------------------------------
create sequence if not exists sim_units_code_seq;

create or replace function sim_gen_unit_code()
returns text
language sql
stable
as $$
  select 'U-' || to_char(now() at time zone 'Europe/London', 'YYMMDD') || '-'
         || lpad(nextval('sim_units_code_seq')::text, 4, '0')
$$;

create table if not exists sim_units (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique default sim_gen_unit_code(),
  kind              text not null,                       -- e.g. 'tumbler_load' | 'tray' | 'bag' — free text, not
                                                           -- constrained to a fixed enum since this is meant to
                                                           -- roll out past the chicken line to other product lines.
  status            text not null default 'active'        -- 'active' | 'consumed' | 'discarded'
                        check (status in ('active','consumed','discarded')),
  product_id        uuid references sim_products(id),
  component_id      uuid references sim_components(id),
  station           text,
  qty               numeric,                              -- informational only — genealogy below carries no
  uom               text,                                 -- ratios/weights per the design doc; this is just
                                                            -- what was recorded at the moment of labelling.
  notes             text,
  created_via_log_id uuid references sim_task_logs(id),   -- the task log this unit was created during, if any
                                                            -- (e.g. the vacuum-pack run that produced it)
  created_by        uuid references sim_profiles(id) default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists sim_units_kind_idx on sim_units(kind);
create index if not exists sim_units_status_idx on sim_units(status);
create index if not exists sim_units_product_idx on sim_units(product_id);
create index if not exists sim_units_created_via_log_idx on sim_units(created_via_log_id);

-- ---------------------------------------------------------------------------
-- sim_unit_genealogy — "this unit was made from that unit". Multiple rows for
-- one child if merged from >1 parent; multiple rows for one parent if split
-- into many children. No weights/ratios — see design doc §4.
-- ---------------------------------------------------------------------------
create table if not exists sim_unit_genealogy (
  id                 uuid primary key default gen_random_uuid(),
  parent_unit_id     uuid not null references sim_units(id),
  child_unit_id      uuid not null references sim_units(id),
  created_via_log_id uuid references sim_task_logs(id),   -- the split/merge event's task log, if applicable
  created_by         uuid references sim_profiles(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  constraint sim_unit_genealogy_no_self check (parent_unit_id <> child_unit_id),
  constraint sim_unit_genealogy_unique unique (parent_unit_id, child_unit_id)
);
create index if not exists sim_unit_genealogy_parent_idx on sim_unit_genealogy(parent_unit_id);
create index if not exists sim_unit_genealogy_child_idx on sim_unit_genealogy(child_unit_id);

-- ---------------------------------------------------------------------------
-- sim_unit_log_members — "this unit was part of that run" where a run is an
-- existing sim_task_logs row (typically is_batch = true: an oven cycle, a
-- chiller stay). A unit can appear in many runs over its life; a run can hold
-- many units up to its equipment's practical capacity (soft-checked in the UI,
-- not enforced here — see design doc §6 open item).
-- ---------------------------------------------------------------------------
create table if not exists sim_unit_log_members (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references sim_units(id),
  log_id     uuid not null references sim_task_logs(id),
  added_by   uuid references sim_profiles(id) default auth.uid(),
  added_at   timestamptz not null default now(),
  constraint sim_unit_log_members_unique unique (unit_id, log_id)
);
create index if not exists sim_unit_log_members_unit_idx on sim_unit_log_members(unit_id);
create index if not exists sim_unit_log_members_log_idx on sim_unit_log_members(log_id);

-- ---------------------------------------------------------------------------
-- RLS — mirrors sim_ccp_checks / sim_batch_inputs: anyone signed in can read;
-- insert requires a real profile; update/delete restricted to manager/admin
-- (these are traceability records — once created they shouldn't be casually
-- editable by whoever's holding the scanner), except a creator can delete
-- their own very-recent mistake, matching sim_batch_inputs_delete.
-- ---------------------------------------------------------------------------
alter table sim_units enable row level security;
alter table sim_unit_genealogy enable row level security;
alter table sim_unit_log_members enable row level security;

create policy sim_units_select on sim_units for select using (true);
create policy sim_units_insert on sim_units for insert
  with check (exists (select 1 from sim_profiles where sim_profiles.id = auth.uid()));
create policy sim_units_update on sim_units for update
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));
create policy sim_units_delete on sim_units for delete
  using (created_by = auth.uid() or sim_current_role() = any (array['admin','manager']));

create policy sim_unit_genealogy_select on sim_unit_genealogy for select using (true);
create policy sim_unit_genealogy_insert on sim_unit_genealogy for insert
  with check (exists (select 1 from sim_profiles where sim_profiles.id = auth.uid()));
create policy sim_unit_genealogy_update on sim_unit_genealogy for update
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));
create policy sim_unit_genealogy_delete on sim_unit_genealogy for delete
  using (created_by = auth.uid() or sim_current_role() = any (array['admin','manager']));

create policy sim_unit_log_members_select on sim_unit_log_members for select using (true);
create policy sim_unit_log_members_insert on sim_unit_log_members for insert
  with check (exists (select 1 from sim_profiles where sim_profiles.id = auth.uid()));
create policy sim_unit_log_members_update on sim_unit_log_members for update
  using (sim_current_role() = any (array['admin','manager']))
  with check (sim_current_role() = any (array['admin','manager']));
create policy sim_unit_log_members_delete on sim_unit_log_members for delete
  using (added_by = auth.uid() or sim_current_role() = any (array['admin','manager']));

-- ---------------------------------------------------------------------------
-- Tamper-evident change log — reuse the existing generic trigger function,
-- same as every other compliance-relevant table.
-- ---------------------------------------------------------------------------
drop trigger if exists sim_units_trace on sim_units;
create trigger sim_units_trace
  after insert or update or delete on sim_units
  for each row execute function sim_log_trace_change();

drop trigger if exists sim_unit_genealogy_trace on sim_unit_genealogy;
create trigger sim_unit_genealogy_trace
  after insert or update or delete on sim_unit_genealogy
  for each row execute function sim_log_trace_change();

drop trigger if exists sim_unit_log_members_trace on sim_unit_log_members;
create trigger sim_unit_log_members_trace
  after insert or update or delete on sim_unit_log_members
  for each row execute function sim_log_trace_change();
