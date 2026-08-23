-- Answers logged on the QA board, 23 Aug.
--
-- Black Beans (sf7d12c2) -- "different recipes". So "Black Beans Cooked PS" is not
-- made from the meat-book "Black Beans" recipe; its own line is dry beans bought in.
-- Unlink as raw. No-op on every figure (a self-link already counted as raw).
--
-- Bavette (sf810bc2) -- "bavette is an ingredient then you add salt and water".
-- That describes the "Bavette" brine: the bavette line in it is RAW meat, not the
-- finished "Bavette Steak" prep it was linked to. Two Meat Team products, both cut
-- from raw bavette, neither feeding the other. This one MOVES NUMBERS:
--   Bavette Steak total     16.61 -> 7.30 kg (the 9.31 kg of nested demand was wrong)
--   raw bavette to order    19.93 -> 18.07 kg
-- Its own sort_order-0 line is raw too, and is unlinked with it.

update public.sim_component_ingredients
set sub_recipe_id = null
where id in (
  '7f169c7b-be81-4b7a-9544-c2d6eddaa835',  -- Black Beans Cooked PS / Black Beans  (no-op)
  '23cf5237-f7ca-4948-9877-89eda2300cb4',  -- Bavette Steak / Bavette Steak        (no-op)
  '44fd6612-351b-46bb-b8a5-d52af05f123d'   -- Bavette / Bavette Steak              (real change)
);
