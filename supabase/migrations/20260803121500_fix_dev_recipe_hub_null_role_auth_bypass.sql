-- Fix: sim_dev_add_version / sim_dev_set_version_status / sim_dev_lock_version
-- used `if sim_current_role() not in ('admin','manager') then raise exception...`.
-- sim_current_role() returns NULL for any caller with no matching sim_profiles
-- row (including a fully anonymous/unauthenticated request). In SQL, `NULL NOT
-- IN (...)` evaluates to NULL, and PL/pgSQL's `IF NULL THEN` is treated as
-- false -- so the exception never fired and the authorisation check was a
-- no-op for exactly the callers it most needed to stop. Caught by testing an
-- unauthenticated curl call against sim_dev_add_version during this build: it
-- got past the auth check and only failed later on an unrelated FK check.
--
-- Fix: coalesce to a value that's never a valid role before comparing, so an
-- unmatched/anonymous caller is explicitly rejected instead of silently
-- passing. Verified after this fix: anonymous calls to all three RPCs return
-- "Not authorised" (P0001), and a direct anonymous table insert is separately
-- blocked by RLS (belt and braces -- RLS's `= ANY(...)` form was never
-- vulnerable to this NULL trap, only the PL/pgSQL `IF` checks were).

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
  if coalesce(sim_current_role(),'none') not in ('admin','manager') then
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

create or replace function public.sim_dev_set_version_status(p_version_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(sim_current_role(),'none') not in ('admin','manager') then
    raise exception 'Not authorised';
  end if;
  if p_status not in ('draft','sent_for_tasting','client_feedback') then
    raise exception 'Use sim_dev_lock_version() to approve and lock a version';
  end if;
  update public.sim_dev_recipe_versions set status = p_status where id = p_version_id;
end;
$function$;

create or replace function public.sim_dev_lock_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recipe_id uuid;
begin
  if coalesce(sim_current_role(),'none') not in ('admin','manager') then
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
