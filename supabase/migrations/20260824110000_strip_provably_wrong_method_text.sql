-- Removing method text that is PROVABLY wrong for the recipe it sits on. Nothing is
-- invented here and nothing correct is touched -- each removal is arithmetic or plain fact.
--
-- 1. "Add 2kg quinoa to the deep tray and 4kg water" implies the ingredient is 2/(2+4)
--    = 0.3333 of the batch. Nine recipes carry it. Exactly two have that ratio -- Black
--    Quinoa Cooked and White Quinoa Cooked, both 0.3333 -- and they keep it. The other
--    seven are 0.41, 0.41, 0.41, 0.40, 0.455, 1.0 and 0.5789, so the text cannot describe
--    them. Telling someone making Penne to add quinoa is worse than telling them nothing.
--
-- 2. "Divide marinade equally by number of trays with chicken meat" is a stray line pasted
--    across recipes with no marinade and no chicken -- Cheesy Mash, Couscous, Rosemary
--    Potatoes, Tofu, Paradise Rice among them. It is removed everywhere it appears,
--    including from recipes where it sits among otherwise valid steps.
--
-- What is left blank is left blank on purpose. Times, temperatures and CCPs cannot be
-- derived from ingredients and must come from the kitchen.

update public.sim_component_recipes r
set method = '[]'::jsonb
where r.active
  and array_to_string(array(select jsonb_array_elements_text(r.method)), ' ') ilike '%2kg quinoa%'
  and not exists (
    select 1 from public.sim_component_ingredients i
    where i.recipe_id = r.id and i.sort_order = 0
      and abs(i.ratio_per_kg - 0.3333) < 0.002);

update public.sim_component_recipes r
set method = coalesce((
      select jsonb_agg(step order by ord)
      from (select step, ord from jsonb_array_elements_text(r.method) with ordinality as t(step, ord)) s
      where s.step not ilike '%divide marinade equally%'
    ), '[]'::jsonb)
where r.active
  and array_to_string(array(select jsonb_array_elements_text(r.method)), ' ') ilike '%divide marinade equally%';
