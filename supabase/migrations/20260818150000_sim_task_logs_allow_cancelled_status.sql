-- Adds a 'cancelled' state so an admin can clear a task that was never real
-- work, WITHOUT deleting the row. As of 18 Aug 2026 there are 32 tasks stuck
-- open across 11 people, the oldest from 24 June; 31 of the 32 have no
-- amount produced and no photo, and 8 were started within seconds of an
-- identical task by the same person (four Brisket Trims inside four seconds)
-- -- i.e. someone tapping START again because a slow connection made the
-- first tap look like it had not registered.
--
-- Deleting them would be simpler but this is a food-production record: an
-- audit should be able to see that a task existed and was withdrawn, by whom
-- and why, rather than finding a silent gap. 'cancelled' keeps the row and
-- the reason while removing it from every operational view.
--
-- Safe against existing consumers, all of which use positive filters:
--   sim_public_dashboard  -- filters on 'in_progress'            -> excluded
--   sim_equipment_state   -- status in ('in_progress','paused')  -> excluded
--   loadActive()          -- .in(['in_progress','paused'])       -> excluded
--   Manage history        -- .eq('completed')                    -> excluded
--   performance.js        -- .eq('completed')                    -> excluded
-- dashboard.js used status <> 'completed' to mean "running", so it is updated
-- in the same change to treat cancelled as closed.
--
-- Note for whoever writes the cancel path: set status='cancelled' and do NOT
-- set finish_time. sim_calc_totals() force-sets status to 'completed' the
-- moment finish_time is non-null, which would then trip the units/CCP gates.

alter table public.sim_task_logs drop constraint if exists sim_task_logs_status_check;
alter table public.sim_task_logs add constraint sim_task_logs_status_check
  check (status = any (array['in_progress'::text, 'paused'::text, 'completed'::text, 'cancelled'::text]));
