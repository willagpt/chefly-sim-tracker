-- Every CONSUMER now reads v_d2c_current_order_items, so today's numbers are
-- right. But the raw d2c_order_items table still ACCUMULATES the superseded
-- rows (the upstream chefly-orders-sync upserts by the website's OrderItem.id
-- and has no delete path), so the trap is still armed: the next person to
-- write `sum(quantity) from d2c_order_items` reintroduces the exact bug that
-- put 90 Penne Bolognese on the 19 Aug pack card instead of 85.
--
-- This makes the raw table self-healing so correctness stops depending on
-- every future author knowing to use the view.
--
-- Superseded rows are ARCHIVED, not destroyed: they move to
-- d2c_order_items_superseded (same shape + archived_at) before deletion, so
-- this is reversible and the pre-edit state of an order stays inspectable.
--
-- Safety brakes, all inside one transaction:
--   * a row is only ever touched if it is absent from v_d2c_current_order_items
--     -- i.e. a newer sync run exists for that same order;
--   * nothing is archived unless the table has rows at all;
--   * if a single run would move more than p_max_pct of the table (default
--     10%; the steady-state figure is ~2%), it ABORTS and reports instead --
--     a sudden spike means the sync misbehaved, and the safe response to that
--     is to stop and be looked at, never to delete in bulk.

create table if not exists public.d2c_order_items_superseded (
  like public.d2c_order_items including defaults,
  archived_at timestamptz not null default now()
);

alter table public.d2c_order_items_superseded enable row level security;

comment on table public.d2c_order_items_superseded is
  'Old copies of order lines replaced when a customer edited their box, moved here by '
  'sim_prune_superseded_order_items(). Kept for inspection; nothing reads it operationally.';

comment on table public.d2c_order_items is
  'Website order lines. WARNING: historically accumulated superseded copies of edited '
  'orders because the upstream sync upserts by website id and cannot delete. '
  'sim_prune_superseded_order_items() now clears those nightly, but ALWAYS prefer '
  'v_d2c_current_order_items when summing quantities.';

create or replace function public.sim_prune_superseded_order_items(p_max_pct numeric default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total bigint;
  v_stale bigint;
  v_pct numeric;
  v_moved bigint;
begin
  select count(*) into v_total from d2c_order_items;
  if v_total = 0 then
    return jsonb_build_object('ok', true, 'skipped', 'table empty', 'archived', 0);
  end if;

  select count(*) into v_stale
  from d2c_order_items oi
  where not exists (
    select 1 from v_d2c_current_order_items c where c.id = oi.id
  );

  if v_stale = 0 then
    return jsonb_build_object('ok', true, 'archived', 0, 'total_rows', v_total);
  end if;

  v_pct := round(100.0 * v_stale / v_total, 2);
  if v_pct > p_max_pct then
    return jsonb_build_object(
      'ok', false,
      'aborted', 'stale share above safety limit -- not deleting, needs a look',
      'stale_rows', v_stale, 'total_rows', v_total,
      'stale_pct', v_pct, 'limit_pct', p_max_pct
    );
  end if;

  with stale as (
    select oi.* from d2c_order_items oi
    where not exists (select 1 from v_d2c_current_order_items c where c.id = oi.id)
  ), moved as (
    insert into d2c_order_items_superseded
    select s.*, now() from stale s
    returning id
  )
  delete from d2c_order_items d
  using moved m where d.id = m.id;
  get diagnostics v_moved = row_count;

  return jsonb_build_object('ok', true, 'archived', v_moved,
                            'total_rows_before', v_total, 'stale_pct', v_pct);
end;
$function$;

comment on function public.sim_prune_superseded_order_items(numeric) is
  'Archives then removes order-line rows superseded by a newer sync run, so the raw '
  'table stops over-counting for consumers that read it directly. Aborts if the stale '
  'share exceeds the safety limit.';

revoke all on function public.sim_prune_superseded_order_items(numeric) from public, anon, authenticated;
