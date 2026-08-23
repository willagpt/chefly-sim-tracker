-- The Sunday sheet's job 1 (Black Lentils) read zero.
--
-- The previous migration's header note guessed the cause was recipe "Black Daal
-- Makhani" having no component_id. That is true, but it is not why the Sunday line
-- was blank -- the dahl is a red herring. The black lentils on the Sunday sheet are
-- for the SKU 15 mix (Sweet Potato / Kale / Lentils / Quinoa, the Rosemary Salmon
-- side), which is exactly where the workbook's own formula points:
--
--     'Black Lentils'!I23  =  'Sweet Potato, Kale, Lentils and'!I11
--
-- That mix's recipe calls its ingredient line plain "Lentils". The recipe that cooks
-- them is called "Black Lentils Cooked C". The importer matched sub-recipes by name,
-- so the two never met and everything below the link read zero.
--
-- Verified against the 2026-08-26 run before applying:
--     mix demand 14.31 kg  x 0.22  = 3.148 kg cooked black lentils
--                          x 0.38  = 1.196 kg raw brown lentils
--     workbook Sunday sheet ........  1.2189 kg raw
--
-- Note on raw vs cooked: the workbook's Sunday tab is inconsistent about which it
-- shows. Black Lentils, Quinoa, Black Beans, Pearl Barley, Black Rice and Black
-- Quinoa all read from the recipe's first ingredient row (RAW weight); Basmati and
-- Wild Basmati read from the cooked-yield row (COOKED weight). The app reports
-- cooked throughout, so this line shows 3.15 kg where the paper sheet shows 1.22 kg.
-- Both are correct; they answer different questions. Surfacing both is open.

update public.sim_component_ingredients i
set sub_recipe_id = r.id
from public.sim_component_recipes r,
     public.sim_component_recipes parent
where r.name = 'Black Lentils Cooked C'
  and parent.name = 'Roasted Sweet Potato, Kale, Lentils, Quinoa, SKU 15'
  and i.recipe_id = parent.id
  and i.name = 'Lentils'
  and i.sub_recipe_id is null;
