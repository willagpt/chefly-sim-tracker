-- Drive order ingest (applied to willa-services 23 Sep 2026 as drive_order_ingest).
-- Supports the "Fetch final orders from Drive" card on the Trays & Pallets screen:
-- sim_drive_files remembers which Final Orders PDFs have already been imported
-- (keyed by Drive file id + modifiedTime, so an edited PDF re-imports), and
-- sim_ws_meals.po_aliases remembers PO meal names ("Slow-Cooked Beef Brisket
-- Barbacoa") that map onto tracker meals ("Mexican Brisket Bowl"), pipe-separated.

alter table public.sim_ws_meals add column if not exists po_aliases text;

create table if not exists public.sim_drive_files (
  file_id       text primary key,
  name          text not null,
  modified_time text,
  parsed_at     timestamptz,
  applied_at    timestamptz,
  week_start    date,
  note          text
);

alter table public.sim_drive_files enable row level security;

drop policy if exists "sim_drive_files_read" on public.sim_drive_files;
create policy "sim_drive_files_read" on public.sim_drive_files
  for select using (true);

drop policy if exists "sim_drive_files_write" on public.sim_drive_files;
create policy "sim_drive_files_write" on public.sim_drive_files
  for all
  using (sim_current_role() = any(array['admin','manager']))
  with check (sim_current_role() = any(array['admin','manager']));
