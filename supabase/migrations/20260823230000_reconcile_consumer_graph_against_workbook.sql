-- Rebuilt the workbook's own consumption graph and diffed it against the app's.
--
-- Every prep tab in the workbook has an anchor cell whose formula names the tabs that
-- consume it -- e.g. 'Carrot Diced, Steamed'!I23 = 'Egg Fried Basmati'!I16 + 'Biryani 1'!I18.
-- That is an authoritative parts list with years of production behind it, and far better
-- evidence than matching ingredient names by string similarity, which is how the earlier
-- links were proposed.
--
-- 62 prep-to-prep edges on the sheet; 47 already existed in the app. These are the 14
-- that did not -- each an ingredient line sitting unlinked, which is why the app was
-- understating. James: "the sheet is correct, but the app is not calculating all the
-- components." That is exactly what the diff shows.
--
-- Two labels are stale on the sheet, but the formula settles where they point:
--   "Cavolo Nero, cooked" -> the Kale IQF prep (cavolo nero is a kale)
--   "Aduki Beans, cooked" -> Black Beans; the dish is literally called
--                            "Sweet Potato, Cavolo Nero, Black Beans, Quinoa"

update public.sim_component_ingredients as i
set sub_recipe_id = (select id from public.sim_component_recipes
                     where name = v.target_name and active limit 1)
from (values
  ('Carrots',                          'Biryani 1',                                          'Carrots Diced, Steamed'),
  ('Cavolo Nero, cooked',              'Sweet Potato, Cavolo Nero, Black Beans, Quinoa',      'KALE IQF, Steamed'),
  ('Aduki Beans, cooked',              'Sweet Potato, Cavolo Nero, Black Beans, Quinoa',      'Black Beans Cooked PS'),
  ('Pok Choy Mix',                     'Edamame, Pok Choy Mix, SKU 9',                        'Broccoli, Cauliflower and Spring Greens'),
  ('Lemon Tahini Olive Oil',           'Roasted Sweet Potato, Kale, Lentils, Quinoa, SKU 15', 'Lemon, Tahini and Olive Oil Dressing, SKU 8, 15'),
  ('Chermoula',                        'Couscous, Cooked',                                   'MOORISH CHERMOULA, SKU 22'),
  ('Orange Carrot',                    'Roasted Carrots and Sweet Potato',                   'Roasted  Orange Carrots'),
  ('Roast Potato',                     'Roast Veg for Turkey, 30',                           'Rosemary Potatoes'),
  ('Verde Sauce',                      'Farfalle Verde',                                     'Verde'),
  ('Vermicelli Glass Noodles, Cooked', 'Vermicelli in BBQ Sauce, 39',                        'Vermicelli'),
  ('Basmati Rice',                     'Basmati and Black Quinoa Mix',                       'Basmati Rice PS'),
  ('Garlic Oil',                       'Green Beans , SKU 3, 22',                            'Garlic & Black Pepper Oil, SKU 39, 58'),
  ('Garlic Oil',                       'Broccoli and Kale, SKU 58',                          'Garlic & Black Pepper Oil, SKU 39, 58'),
  ('Potato Cubed',                     'Saag Aloo',                                          'Potatoes Diced, Steamed')
) as v(line, consumer, target_name)
where i.name = v.line
  and i.recipe_id = (select id from public.sim_component_recipes where name = v.consumer and active limit 1)
  and i.sub_recipe_id is null;
