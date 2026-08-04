-- Wholesale team station accounts: a profile pinned to one packing team.
-- When ws_team is 'A' or 'B' and the user is not a manager/admin, the app
-- locks that login to the Wholesale pack-day screen for that team only
-- (dedicated tablet stations on the pack line).
-- NOTE: applied to the live DB via Supabase MCP on 2026-08-04; this file is
-- the versioned record.
alter table public.sim_profiles
  add column if not exists ws_team text check (ws_team in ('A','B'));

create or replace function public.sim_set_ws_team(p_email text, p_team text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce((select role from public.sim_profiles where id=auth.uid()),'') <> 'admin' then
    raise exception 'Only admins can change wholesale station accounts';
  end if;
  if p_team is not null and p_team not in ('A','B') then
    raise exception 'Team must be A or B (or empty to clear)';
  end if;
  update public.sim_profiles set ws_team = p_team where lower(email)=lower(p_email);
end$$;
