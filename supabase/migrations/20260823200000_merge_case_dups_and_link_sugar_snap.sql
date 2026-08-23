-- Three more duplicate spellings surfaced once the first 15 were merged. These differ
-- only in capitalisation, so they need no judgement -- the same rule Kaja confirmed.
update public.sim_component_ingredients set name = v.canon
from (values
  ('Tomatoes, crushed', 'Tomatoes, Crushed'),
  ('Coriander, ground', 'Coriander, Ground'),
  ('Ginger, ground',    'Ginger, Ground')
) as v(old, canon)
where public.sim_component_ingredients.name = v.old;

-- "Sugar Snap Peas, steamed" was being ordered as a raw purchase at 1.30 kg, when the
-- app already has the prep that makes it. Linking routes it through the 1.05 steaming
-- yield and lands on 1.36 kg of raw sugar snap -- against the sheet's 1.363. That match
-- is the confirmation, not the name similarity.
update public.sim_component_ingredients
set sub_recipe_id = (select id from public.sim_component_recipes where name = 'Sugar Snap, Steamed')
where name = 'Sugar Snap Peas, steamed';
