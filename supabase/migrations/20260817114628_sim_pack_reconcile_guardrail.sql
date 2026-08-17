-- GUARDRAIL: prove the pack plan matches the website, per SKU, on demand.
--
-- The 19 Aug 2026 incident (pack card said 90 Penne Bolognese, website said
-- 85) was invisible until someone hand-compared a downloaded CSV. Nothing in
-- the system asserted "these two agree". These functions make that assertion
-- checkable in one call, and cheap enough to run on every page load.
--
-- sim_pack_reconcile(date) recomputes demand straight from live website
-- orders and diffs it against what the pack line is actually being told to
-- pack (sim_pack_runs), returning a per-SKU breakdown of anything that
-- disagrees. It reads the SAME canonical view the sync writes from, so a
-- clean result means the plan genuinely reflects the website -- not merely
-- that the sync ran without erroring.
--
-- Rows already started/finished on the floor are reported separately
-- ('locked_mismatch'): the sync deliberately never rewrites a dish a human
-- has acted on, so if demand moved after packing began that needs a person,
-- not a silent overwrite. That is exactly the 19 Aug case -- 90 packed
-- against a true 85.

create or replace function public.sim_pack_reconcile(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_shift_id uuid;
  v_rows jsonb;
  v_truth_total integer;
  v_plan_total integer;
  v_mismatches integer;
  v_locked integer;
  v_synced_at timestamptz;
begin
  select id into v_shift_id from sim_pack_shifts where shift_date = p_date;

  select max(o.synced_at) into v_synced_at
  from d2c_orders o
  where o.status = 'paid' and o.delivery_date::date = p_date;

  with truth as (
    select coalesce(m.planner_sku, dp.sku, 'D2C-' || oi.product_id::text) as sku,
           coalesce(m.planner_name, dp.name, oi.product_name, 'Unknown product') as dish_name,
           sum(oi.quantity)::integer as qty
    from d2c_orders o
    join v_d2c_current_order_items oi on oi.order_id = o.id
    left join d2c_product_map m on m.v2_product_id = oi.product_id
    left join d2c_products dp on dp.id = oi.product_id
    where o.status = 'paid' and o.delivery_date::date = p_date
    group by 1, 2
  ),
  plan as (
    select r.sku, r.dish_name, r.planned_qty, r.qty_packed, r.status
    from sim_pack_runs r
    where r.shift_id = v_shift_id
  ),
  joined as (
    select coalesce(t.sku, p.sku) as sku,
           coalesce(t.dish_name, p.dish_name) as dish_name,
           t.qty as website_qty,
           p.planned_qty as plan_qty,
           p.qty_packed,
           p.status,
           case
             when p.sku is null then 'missing_from_plan'
             when t.sku is null then 'not_ordered_but_in_plan'
             when p.planned_qty is distinct from t.qty
                  and p.status in ('done','packing','skipped') then 'locked_mismatch'
             when p.planned_qty is distinct from t.qty then 'plan_stale'
             else 'match'
           end as verdict
    from truth t
    full outer join plan p on p.sku = t.sku
  )
  select coalesce(jsonb_agg(to_jsonb(j) order by j.sku), '[]'::jsonb),
         count(*) filter (where j.verdict not in ('match'))::integer,
         count(*) filter (where j.verdict = 'locked_mismatch')::integer
    into v_rows, v_mismatches, v_locked
  from joined j
  where j.verdict <> 'match';

  select coalesce(sum(oi.quantity),0)::integer into v_truth_total
  from d2c_orders o
  join v_d2c_current_order_items oi on oi.order_id = o.id
  where o.status = 'paid' and o.delivery_date::date = p_date;

  select coalesce(sum(planned_qty),0)::integer into v_plan_total
  from sim_pack_runs where shift_id = v_shift_id;

  return jsonb_build_object(
    'date', p_date,
    'ok', coalesce(v_mismatches,0) = 0,
    'website_total_meals', v_truth_total,
    'plan_total_meals', v_plan_total,
    'difference', v_plan_total - v_truth_total,
    'mismatch_count', coalesce(v_mismatches,0),
    'locked_mismatch_count', coalesce(v_locked,0),
    'orders_synced_at', v_synced_at,
    'checked_at', now(),
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$function$;

comment on function public.sim_pack_reconcile(date) is
  'Recomputes pack-day demand from live website orders and diffs it against sim_pack_runs per SKU. '
  'ok=false means the pack line is being told to pack something the website does not agree with.';

-- Visibility on the one case the canonical view deliberately does not
-- resolve: an order whose line items are OLDER than the order row itself,
-- i.e. the last sync refreshed the order but returned no items for it. The
-- view falls back to that order's last known items rather than dropping its
-- dishes off the pack list silently; this function makes those orders
-- inspectable. Every occurrence at time of writing was a 'skipped' customer
-- (the website empties a skipped box), which the status='paid' filter
-- already excludes -- but a 'paid' order showing up here would be a real
-- signal that the upstream orders sync is failing to pull line items.
create or replace function public.sim_pack_order_drift(p_horizon_days integer default 60)
returns table(order_id integer, delivery_date date, status text,
              order_synced_at timestamptz, items_synced_at timestamptz,
              item_rows bigint, qty bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select o.id, o.delivery_date::date, o.status, o.synced_at,
         max(oi.synced_at), count(oi.id), sum(oi.quantity)
  from d2c_orders o
  join d2c_order_items oi on oi.order_id = o.id
  where o.delivery_date::date between current_date and current_date + p_horizon_days
  group by o.id, o.delivery_date, o.status, o.synced_at
  having max(oi.synced_at) < o.synced_at
  order by o.delivery_date, o.id;
$function$;

grant execute on function public.sim_pack_reconcile(date) to authenticated;
grant execute on function public.sim_pack_order_drift(integer) to authenticated;
revoke all on function public.sim_pack_reconcile(date) from anon;
revoke all on function public.sim_pack_order_drift(integer) from anon;
