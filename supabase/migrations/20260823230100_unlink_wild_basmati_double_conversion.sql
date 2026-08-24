-- "Wild & Basmati Rice PS" = Basmati Rice 0.4523 + Wild Rice 0.0238 + WATER 0.5238 + Salt 0.0095.
-- That water line is the same 0.5238 as Basmati Rice PS itself. It cooks its own rice from
-- dry, so its "Basmati Rice" line is the dry sack -- not the finished Basmati Rice PS prep
-- it was pointed at. Third instance of the same fault, and the largest:
--   22.90 kg of Wild & Basmati x 0.4523 = 10.36 kg of Basmati Rice PS that nobody makes.
-- The workbook agrees: its Basmati Rice tab does not list Wild Basmati as a consumer.
update public.sim_component_ingredients
set sub_recipe_id = null
where name = 'Basmati Rice'
  and recipe_id = (select id from public.sim_component_recipes where name = 'Wild & Basmati Rice PS');
