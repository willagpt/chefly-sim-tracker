-- Recipes had no way to be retired -- only components did. Anything imported from a
-- workbook tab stayed in the app forever, which is why five dead Yolk recipes and
-- three "Copy of" duplicates were still sitting in the list.
alter table public.sim_component_recipes
  add column if not exists active boolean not null default true;

comment on column public.sim_component_recipes.active is
  'False = retired. Kept rather than deleted so historic batches still resolve their recipe.';

-- Yolk is no longer a customer (James, 23 Aug). None of these have a component or any
-- demand this week. Retiring "Marinated Cooked Chicken" also closes the last
-- self-referencing ingredient line in the database -- the question of whether it should
-- link to "Y2 Marinated Chicken" is moot once neither is made.
update public.sim_component_recipes set active = false
where id in (
  'a0d1619b-96b2-459a-b84c-3431e54d83c1',  -- Marinated Cooked Chicken  (Yolk Chicken, Cooked)
  '187f94ab-fa10-4bd4-aa37-ae7d0bede39e',  -- Y2 Marinated Chicken      (Yolk Chicken)
  '1644af18-9995-40d2-bd81-bfa0e98d585a',  -- Yolk Chicken              (Yolk Chicken x)
  '58a8f654-d2d2-4bdb-9502-9e13dd0dbc94',  -- Yolk Spice Mix            (Copy of ...)
  '4d0f2342-4098-4834-97cb-99e79cde0875'   -- Yolk Spice Mix II
);

-- NOT retired: "Bavette" (tab "Yolk Bavette"). Despite the tab it came from, it is the
-- live D2C product -- 10.74 kg feeding SKUs 4, 5 and 70 (101 meals). The tab name says
-- where the recipe was copied from, not who it is for.

-- "Xmas Turkey" existed twice. James: one is a meat preparation, one is a dish, and the
-- marinade is on its own sheet. The demand confirms which is which: the "Turkey Cooked"
-- tab carries component Turkey and 3.70 kg for SKU 30 Turkey Roast (37 meals); the
-- "Copy of" tabs carry nothing at all.
update public.sim_component_recipes set name = 'Turkey, Cooked'
where id = '46d6c927-2b5e-4c81-b9f3-8ec6f6729ca6';
update public.sim_components set name = 'Turkey, Cooked'
where id = (select component_id from public.sim_component_recipes
            where id = '46d6c927-2b5e-4c81-b9f3-8ec6f6729ca6');

update public.sim_component_recipes set active = false
where id in (
  '22c1441e-547a-400e-8254-caab28c0cf73',  -- Xmas Turkey        (Copy of Xmas Turkey Cooked)
  '57d62726-f386-41b7-b6ca-9924b48c8258'   -- Xmas Turkey Marinade (Copy of ...)
);

-- Brisket's yield ratio of exactly 1.0 is CORRECT, not a missing value. James: the
-- brisket is cooked sous vide, the liquor is kept, and it is all mixed back through the
-- shredded product. Nothing leaves the bag. Recorded so it does not get "fixed" later.
update public.sim_component_recipes
set cook_notes = coalesce(cook_notes, '[]'::jsonb) || to_jsonb(array[
  'Sous vide. Keep all the cooking liquor and mix it back through the shredded meat.',
  'Yield ratio is 1.0 by design -- nothing is lost, so raw weight in equals finished weight out.'
])
where id = '296228c9-091a-4d82-a85a-5bc59c3b19b2';
