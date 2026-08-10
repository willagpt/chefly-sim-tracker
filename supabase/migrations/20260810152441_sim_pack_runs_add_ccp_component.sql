-- CCP temperature checks previously recorded a bare reading against the
-- whole dish, with no record of which component was actually probed --
-- ambiguous for multi-component dishes and weak as an audit trail. These
-- columns capture what was probed, picked from the dish's existing BOM
-- (sim_dish_bom -> sim_components, the same list already used for
-- kitchen-readiness) when one is known, or free text when it isn't.
alter table public.sim_pack_runs
  add column start_temp_component text,
  add column finish_temp_component text;

comment on column public.sim_pack_runs.start_temp_component is
  'Which component was probed for the START CCP reading (start_temp_c) -- from the dish BOM when known, free text otherwise.';
comment on column public.sim_pack_runs.finish_temp_component is
  'Which component was probed for the FINISH CCP reading (finish_temp_c) -- from the dish BOM when known, free text otherwise.';
