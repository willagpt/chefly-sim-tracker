-- Answers from the board, 24 Aug. Four of the five "does it go through the prep?"
-- questions came back "raw goes straight in" -- which is what the production sheet said
-- in every case. The workbook was right and the app was inventing prep work.
--
--   Primavera / Red Peppers IQF        -- frozen peppers straight in, not roasted first
--   Verde / Peas, IQF                  -- "frozen peas"
--   Thai Green Curry Sauce / Peas      -- same
--   New Gravy / Carrots, diced 5mm     -- raw carrot cooks in the gravy.
--                                         This link was added by Claude from the ingredient
--                                         name alone; the sheet never had it.
--
-- Squash Risotto KEEPS its link to Roasted Butternut Squash -- "uses the prep, app is
-- right". So the sheet is not exhaustive: it simply does not route risotto that way.
-- Worth remembering before treating a missing sheet edge as proof of an error.

update public.sim_component_ingredients as i
set sub_recipe_id = null
from (values
  ('Red Peppers IQF',    'Primavera'),
  ('Peas, IQF',          'Verde'),
  ('Peas',               'Thai Green Curry Sauce'),
  ('Carrots, diced 5mm', 'New Gravy')
) as v(line, consumer)
where i.name = v.line
  and i.recipe_id = (select id from public.sim_component_recipes where name = v.consumer and active limit 1);

-- "Sweetcorn, Roasted" -- bought in already roasted, so it is a purchase and needs no
-- recipe. Flagged so it stops appearing as a prep with no method behind it.
update public.sim_components set bought_in = true
where name ilike '%sweetcorn%';
