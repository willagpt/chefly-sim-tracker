-- THE ORDER BOOK IS SUPPOSED TO STOP MOVING BEFORE PRODUCTION STARTS. It did not.
--
-- James's process: no new customers after Friday ~16:00; renewals charge Saturday; manual
-- adjustment Saturday; everything locks Sunday 05:00, before pre-production. He believed
-- that was implemented. It was not -- sim_sync_pack_dishes_from_chefly deleted and rebuilt
-- sim_pack_dish_import for every date within 35 days, every morning, with no cut-off.
--
-- For the 26 Aug run that meant four orders placed on Sunday 23rd between 08:34 and 10:12
-- (36 meals) entered a plan the kitchen had already begun. 1,358 meals at the lock point;
-- 1,394 by Monday.
--
-- Production requirements read sim_pack_dish_import, so freezing that table freezes the
-- kitchen's numbers and the packing list together -- which is the point: they must describe
-- the same day.

alter table public.sim_pack_shifts
  add column if not exists locked_at  timestamptz,
  add column if not exists locked_by  uuid,
  add column if not exists lock_note  text;

comment on column public.sim_pack_shifts.locked_at is
  'When this delivery date stopped taking order changes. Set automatically at the Sunday
   05:00 before the delivery, or by hand. While set, the nightly sync leaves the date alone.';

-- The lock point for a delivery date: 05:00 UK on the Sunday of that production week.
-- Same Sunday the prep station already anchors to, so prep, packing and the lock agree.
create or replace function public.sim_lock_point(p_delivery date)
returns timestamptz
language sql immutable
as $function$
  select ((case when extract(dow from p_delivery) = 0 then p_delivery
                else (date_trunc('week', p_delivery::timestamp)::date - 1) end)::text
          || ' 05:00')::timestamp at time zone 'Europe/London';
$function$;

comment on function public.sim_lock_point(date) is
  'Sunday 05:00 UK preceding a delivery date -- the moment its plan stops moving.';

-- What has the order book done since a date was locked? Freezing without showing the
-- drift would just hide the problem somewhere quieter.
create or replace function public.sim_pack_lock_drift(p_date date)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  with locked as (
    select s.locked_at from sim_pack_shifts s where s.shift_date = p_date
  ),
  live as (
    select coalesce(m.planner_sku, dp.sku, 'D2C-' || oi.product_id::text) as sku,
           coalesce(m.planner_name, dp.name, oi.product_name) as dish_name,
           sum(oi.quantity)::int as qty
    from d2c_orders o
    join v_d2c_current_order_items oi on oi.order_id = o.id
    left join d2c_product_map m on m.v2_product_id = oi.product_id
    left join d2c_products dp on dp.id = oi.product_id
    where o.status = 'paid' and o.delivery_date::date = p_date
    group by 1, 2
  ),
  planned as (
    select sku, dish_name, qty from sim_pack_dish_import where import_date = p_date
  ),
  diff as (
    select coalesce(l.sku, p.sku) as sku,
           coalesce(l.dish_name, p.dish_name) as dish_name,
           coalesce(p.qty, 0) as planned_qty,
           coalesce(l.qty, 0) as live_qty
    from live l full outer join planned p on p.sku = l.sku
  )
  select jsonb_build_object(
    'date', p_date,
    'locked_at', (select locked_at from locked),
    'planned_meals', (select coalesce(sum(planned_qty), 0) from diff),
    'live_meals',    (select coalesce(sum(live_qty), 0) from diff),
    'meals_delta',   (select coalesce(sum(live_qty - planned_qty), 0) from diff),
    'dishes_added',   (select count(*) from diff where planned_qty = 0 and live_qty > 0),
    'dishes_removed', (select count(*) from diff where live_qty = 0 and planned_qty > 0),
    'changed', coalesce((select jsonb_agg(jsonb_build_object(
        'sku', sku, 'dish', dish_name, 'planned', planned_qty, 'live', live_qty,
        'delta', live_qty - planned_qty) order by abs(live_qty - planned_qty) desc)
      from diff where planned_qty <> live_qty), '[]'::jsonb)
  );
$function$;

grant execute on function public.sim_lock_point(date) to anon, authenticated;
grant execute on function public.sim_pack_lock_drift(date) to authenticated;
