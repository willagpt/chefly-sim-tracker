-- The 15 groups Kaja confirmed as "Same item — merge".
--
-- The same ingredient was spelled several ways, so the raw-materials total split across
-- them. Harmless on a cook sheet, dangerous on a picking or ordering list -- you either
-- pull twice or miss some entirely. Canonical form is the dominant spelling, tidied.
-- Two are corrected rather than just picked: "Tomatos" -> "Tomatoes", and "Garlic  Oil"
-- had a double space.

update public.sim_component_ingredients set name = v.canon
from (values
  ('Coconut milk',     'Coconut Milk'),
  ('Pomace OIL',       'Pomace Oil'),
  ('SALT',             'Salt'),
  ('White onions',     'White Onions'),
  ('Onions, white',    'White Onions'),
  ('Garlic, IQF',      'Garlic IQF'),
  ('GARLIC, IQF',      'Garlic IQF'),
  ('LIME JUICE',       'Lime Juice'),
  ('GINGER, IQF',      'Ginger IQF'),
  ('Garlic  Oil',      'Garlic Oil'),
  ('CUMIN',            'Cumin'),
  ('Garlic puree',     'Garlic Puree'),
  ('Black pepper',     'Black Pepper'),
  ('black pepper',     'Black Pepper'),
  ('Cumin, ground',    'Ground Cumin'),
  ('Cumin ground',     'Ground Cumin'),
  ('Rosemary, Dried',  'Dried Rosemary'),
  ('Basmati',          'Basmati Rice'),
  ('Tomato, Crushed',  'Tomatoes, Crushed'),
  ('Tomatos, Crushed', 'Tomatoes, Crushed')
) as v(old, canon)
where public.sim_component_ingredients.name = v.old;
