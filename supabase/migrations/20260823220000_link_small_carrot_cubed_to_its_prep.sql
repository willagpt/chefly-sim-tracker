-- "Carrot Diced, IQF" was the biggest gap left on the QA board: sheet 8.53 kg against
-- the app's 0.23 kg. Reading the workbook's own consumer formula settles it without
-- anyone having to guess, and the answer is in two halves.
--
-- The sheet's anchor cell says what feeds the prep:
--   'Carrot Diced, Steamed'!I23 = 'Egg Fried Basmati'!I16 + 'Biryani 1'!I18
--                                =  0.550 kg          +  7.205 kg
--
-- 1. The app was genuinely missing the Egg Fried Basmati consumer. That recipe carries
--    "Small Carrot cubed, steamed" -- the same wording the sheet uses -- sitting
--    unlinked. Linked here. This is the real fix, and the sheet was right: it knew
--    carrots go into Egg Fried Basmati and the app did not.
--
-- 2. The other 7.2 kg -- 93% of the sheet's figure -- is Biryani, and Biryani 1 is
--    driven by ' 74. Chicken Biryani'!I12 = 90.06 kg. SKU 74 sits at quantity 0 on
--    All Dishes; James already confirmed that entry was added to the workbook by hand
--    in error. So the sheet's TOTAL carries a phantom, even though its STRUCTURE is right.
--
-- Carrot Diced, IQF: 0.23 -> 0.90 kg. Against the sheet's 0.605 kg once Biryani is
-- excluded; the remaining difference is Egg Fried Basmati Rice itself (app 6.04 kg,
-- sheet 5.499 kg), which is a separate question.
--
-- Worth keeping as a rule: the workbook's anchor formula is an authoritative list of
-- what consumes each prep -- years of production stand behind it. Its totals are only
-- as good as the order quantities driving them.

update public.sim_component_ingredients
set sub_recipe_id = (select id from public.sim_component_recipes where name = 'Carrots Diced, Steamed')
where name = 'Small Carrot cubed, steamed';
