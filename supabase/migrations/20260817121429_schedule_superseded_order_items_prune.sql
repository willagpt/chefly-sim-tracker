-- Runs at 04:55 UTC, in the 15-minute gap between chefly-d2c-orders-sync
-- (04:45, which creates the superseded rows) and sim-pack-dish-sync (05:00,
-- which builds the day's pack list) -- so the raw table is already clean by
-- the time anything reads it each morning.
select cron.schedule(
  'd2c-prune-superseded-order-items',
  '55 4 * * *',
  $$select public.sim_prune_superseded_order_items();$$
);
