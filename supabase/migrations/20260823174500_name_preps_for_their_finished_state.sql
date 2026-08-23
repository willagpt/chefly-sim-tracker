-- James, on the Baby Corn chain: "the Baby Corn is an ingredient inside the Baby
-- Corn product, which should actually be called Baby Corn Roasted."
--
-- That is the root cause, not a consequence. The prep and its own raw input carried
-- the same name, so the importer could not tell them apart and joined 36 recipes to
-- themselves. Naming each prep for its finished state makes the collision impossible
-- to recreate -- including by hand, in the sheet, which is how it started.
--
-- Convention: suffix, "<ingredient>, <process>" -- matching the ones already named
-- that way (Courgette, Sliced / Green Beans, steamed / Cauliflower Florets, Steamed).
-- Ratios are unchanged; this is naming only, so no figure moves.
--
-- Process is evidenced for most: the ratio direction (>1 loses weight, <1 hydrates),
-- the station, and the sibling recipes already named. Two are inferred and flagged
-- to James: Tofu (1.2, Mixes) and Brisket -- whose ratio of exactly 1.0 says the
-- brisket loses nothing at all in cooking, which is its own question.

update public.sim_component_recipes set name = 'Baby Corn, Roasted'                      where id = 'b19da2dc-f0ad-4b95-a47c-353def515386';
update public.sim_component_recipes set name = 'Bavette Steak, Grilled'                  where id = '94e928bf-ff28-4f5c-9683-26859a2d749a';
update public.sim_component_recipes set name = 'Brisket, Cooked'                         where id = '296228c9-091a-4d82-a85a-5bc59c3b19b2';
update public.sim_component_recipes set name = 'Butternut Squash Quarter Moons, Roasted' where id = '1eccbf68-d348-429f-a9f4-dcf2b8563bdd';
update public.sim_component_recipes set name = 'Couscous, Cooked'                        where id = '8ed5146f-24b4-4e07-9d93-d0c3d82daccf';
update public.sim_component_recipes set name = 'Edamame, Steamed'                        where id = '68b666ea-53b2-4e32-bc56-94dcae68450e';
update public.sim_component_recipes set name = 'Fennel, Steamed'                         where id = '79d2d437-1f82-40a8-b5d2-6960e5cf9014';
update public.sim_component_recipes set name = 'Gnocchi, Cooked'                         where id = '6650f031-3f6b-43d4-9a18-d0e9804219f0';
update public.sim_component_recipes set name = 'Panga Fish, Baked'                       where id = 'c0b986fb-5c29-4045-b7fd-42c097260b95';
update public.sim_component_recipes set name = 'Peas, Steamed'                           where id = '6d34379d-cfce-4c0e-9920-654735a20ccb';
update public.sim_component_recipes set name = 'Sugar Snap, Steamed'                     where id = '808991fb-89f1-4404-9838-fe05609f1eed';
update public.sim_component_recipes set name = 'Tenderstem Broccoli, Steamed'            where id = '60d5908b-70f2-414a-8673-e99201c47d7b';
update public.sim_component_recipes set name = 'Tofu, Roasted'                           where id = '7231f254-5645-43e4-9c0a-88b4ff394f3d';

-- Keep the component (what Production needs and packing show) in step with its recipe.
update public.sim_components set name = 'Bavette Steak, Grilled'                  where id = '56525a48-dd35-4a1e-8144-2645776b7d41';
update public.sim_components set name = 'Brisket, Cooked'                         where id = '24f9cb55-87ad-4a8e-a824-a4f935b05bf1';
update public.sim_components set name = 'Butternut Squash Quarter Moons, Roasted' where id = '63c8d713-a46a-49df-b31a-6b93aa9c8049';
update public.sim_components set name = 'Couscous, Cooked'                        where id = 'e7dd5a3c-de51-474a-8b21-aceb1da8d727';
update public.sim_components set name = 'Gnocchi, Cooked'                         where id = '16b633c0-20e7-4e90-9254-2537ac08319e';
update public.sim_components set name = 'Panga Fish, Baked'                       where id = '6c788aec-e064-40ea-a1c5-94c00f52a01b';
update public.sim_components set name = 'Tofu, Roasted'                           where id = 'cdeab1a7-4222-49c3-a032-b5916ae3df30';

-- "Courgette, Sliced" was the one where the RECIPE was already named correctly and
-- the raw line was not. Fix the line instead: what you buy is courgette.
update public.sim_component_ingredients set name = 'Courgette'
where id = '2773e250-1242-43bd-8b0c-85058e4d5790';

-- Not renamed, deliberately: the orphaned "Black Beans" recipe (meat book, no
-- component, 0 kg). "Black Beans, Cooked" would collide with the Sauces component
-- that actually gets made. James confirmed the two are different recipes, but this
-- one produces nothing -- it is a candidate to retire rather than rename.
