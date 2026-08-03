-- CCP temperature gates on the Packing run sheet.
-- Before a dish can be STARTED the team must probe and record the food
-- temperature; the same applies before it can be STOPPED (finished).
-- Critical limit: 5°C (chilled). Anything above the limit requires a
-- corrective action note, stored alongside the reading.

alter table sim_pack_runs
  add column if not exists start_temp_c        numeric,
  add column if not exists finish_temp_c       numeric,
  add column if not exists start_temp_action   text,
  add column if not exists finish_temp_action  text;

comment on column sim_pack_runs.start_temp_c       is 'CCP: probed food temp (°C) recorded immediately before the dish was started';
comment on column sim_pack_runs.finish_temp_c      is 'CCP: probed food temp (°C) recorded immediately before the dish was finished';
comment on column sim_pack_runs.start_temp_action  is 'Corrective action taken when the start temp was above the 5°C chilled limit';
comment on column sim_pack_runs.finish_temp_action is 'Corrective action taken when the finish temp was above the 5°C chilled limit';
