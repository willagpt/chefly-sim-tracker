-- The workbook importer matched each recipe's own raw-input line (sort_order 0)
-- to the recipe itself, because the raw ingredient and the finished prep share a
-- name once normalised ("Basmati Rice" -> "Basmati Rice PS", "Baby Corn" -> "Baby Corn").
-- A prep can never be its own ingredient. These lines are raw purchases, and the
-- ratio on them is the yield: >1 = loss (roast/steam/trim), <1 = gain (grain/pasta/pulse).
--
-- Both sim_recipe_totals and sim_production_requirements already special-case
-- `sub_recipe_id = recipe_id` (skipped in the walk, counted as raw in the rollup),
-- so this change is a no-op on every number. It only makes the data honest.
-- Verified: recomputing the raws rollup both ways returns zero differing rows.
--
-- Three are deliberately left linked because a genuine upstream recipe exists and
-- the choice needs a human:
--   Black Beans Cooked PS    -> Black Beans (two recipes off one workbook tab)
--   Marinated Cooked Chicken -> Y2 Marinated Chicken
--   Bavette Steak            -> Bavette (brine; the chain may be inverted)

update public.sim_component_ingredients i
set sub_recipe_id = null
where i.sub_recipe_id = i.recipe_id
  and i.id not in (
    '7f169c7b-be81-4b7a-9544-c2d6eddaa835',  -- Black Beans Cooked PS / Black Beans
    '034201e3-6336-43ba-93db-754e98e156f0',  -- Marinated Cooked Chicken / Chicken, Marinated
    '23cf5237-f7ca-4948-9877-89eda2300cb4'   -- Bavette Steak / Bavette Steak
  );
