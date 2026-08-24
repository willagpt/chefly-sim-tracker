-- Kaja: "sheet is right" on both Green Beans and Orzo. One fault explains both.
--
-- The component "Orzo" (feeding "Grilled Chicken and Orzo Salad") was wired to the plain
-- "Orzo, Cooked" recipe -- dry orzo and water. But the dish is a SALAD: the workbook's
-- "Orzo Salad" tab is cooked orzo 0.7 plus sundried tomato, olives, green beans, capers,
-- parsley and pomegranate molasses. The app was treating a composed salad as if it were a
-- pan of plain orzo, so it over-ordered orzo and never ordered the rest.
--
-- The workbook says so directly: 'Orzo'!I23 = 'Orzo Salad'!I11 -- orzo reaches the plate
-- only through the salad, never on its own. "Orzo Salad" sat at 0 kg in the app because
-- nothing pointed at it.
--
-- Both gaps close on this one change:
--   raw orzo         4.39 -> 3.22 kg   (sheet 3.073)  -- was counting the whole salad as orzo
--   raw green beans  4.30 -> 6.28 kg   (sheet 6.07)   -- the salad's green beans, never counted
--
-- Kaja's note also confirms the two green bean products are distinct: "this is green beans
-- for steaming... green beans and oil is a different recipe." The oiled one
-- ("Green Beans, SKU 3, 22") keeps its own component and is untouched.
update public.sim_component_recipes set component_id = null
where name = 'Orzo, Cooked';
update public.sim_component_recipes
set component_id = (select id from public.sim_components where name = 'Orzo')
where name = 'Orzo Salad';
