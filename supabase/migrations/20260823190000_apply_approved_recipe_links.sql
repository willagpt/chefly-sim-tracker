-- The 31 recipe links Kaja approved on the QA board, all "Yes, link it".
--
-- Each is an ingredient line that was never joined to the recipe that makes it, because
-- the line and the recipe are named differently -- the same fault as the Lentils one.
-- Until linked, everything below the line reads zero, so the app has been UNDERSTATING
-- these. Requirements go UP.
--
-- 28 applied here. Three withheld, and the reasons matter:
--
--  * "Jerk Chicken A" -> "Y2 Marinated Chicken": dish discontinued, target retired with
--    the rest of Yolk. Linking two things nobody makes would put a phantom back on the sheets.
--
--  * "Lime and Coriander Rice, Cooked" -> "Basmati Rice PS" and
--    "Spicy Tamarind Butter Beans" -> "Cranberry Beans, Cooked PS": both DOUBLE-CONVERT.
--    The tell is cooking water. Lime and Coriander Rice is Basmati 0.455 + WATER 0.5 +
--    salt + aromatics -- structurally the same as Basmati Rice PS itself (rice 0.45 +
--    water 0.5238 + salt). It cooks its own rice, so its "Basmati Rice" line is DRY.
--    Applying the link invented 5.9 kg of Basmati Rice PS that nobody makes and cut raw
--    basmati to order from 18.11 to 14.85 kg. The beans line says "(uncooked)" outright
--    and its recipe carries "Water for cooking Beans" @0.3636.
--
--    Rule worth keeping: if a recipe carries its own water for cooking an ingredient,
--    that ingredient line is the dry form -- do not link it to the prep that cooks it.
--    Kaja's answers were reasonable from the names alone; the water line was not on the board.

update public.sim_component_ingredients as i
set sub_recipe_id = v.target::uuid
from (values
  ('b5b7e9ea-0483-496a-ac4e-6c29c659d5d9','a692db96-2426-4e17-8d1e-ce121ef5b7dd'), -- Edamame/Sugar Snap/Fennel -> Rice Vinegar Soy Sesame Dressing
  ('7cff438c-9f9b-4d31-860c-0f6e110f8c81','d04fd541-a68e-43c6-9081-d6ac3fdc0ac3'), -- Wild Rice Peppers Squash -> Roasted Red Peppers
  ('50aa2fb9-0bed-4f93-8cb6-5c9dd75e2298','24acc54e-5757-4623-9ec9-1adb52d77416'), -- Japanese Chicken -> Japanese Chicken Marinade
  ('f8b68f54-f79a-426e-ab17-727f22cf23d6','85714236-5708-45dc-a97d-296284701104'), -- Squash/Kale/Barley -> Roasted Butternut Squash
  ('0857629b-0c79-490c-8e41-c1a4bb64e7bc','85714236-5708-45dc-a97d-296284701104'), -- Squash Risotto -> Roasted Butternut Squash
  ('afee7586-6290-43f2-9b00-8e5bf5df7747','e49aae00-f7da-4ed0-b03b-e6d5736b90cd'), -- Squash/Kale/Barley -> Lemon Tahini Olive Oil Dressing
  ('cb2fd396-fe18-4b0b-9dad-de2f463aad0d','e0b92725-1b4d-4ed6-a55a-4ff5e2dc5542'), -- Roasted Carrots & Sweet Potato -> Roasted Yellow Carrots PS
  ('29e21064-fb56-4eb0-b4a2-43fa8aeaa556','4fdd0611-cab9-4421-863d-5c0c34ffe353'), -- Thai Green Curry Sauce -> Thai Green Curry Paste
  ('a47db593-7fa0-4f01-ad47-5917558a0b4a','0ad99bdf-b550-4f19-8d83-04b5739a8f8f'), -- Roast Veg for Turkey -> Roast Parsnip
  ('41cc4760-8fe1-4592-9501-94dbeee8e856','a9e19eab-dee6-45af-ad73-6c19267fa05f'), -- Cauliflower Cheese -> Cauliflower Florets, Steamed
  ('72f8f810-9505-4e1f-857a-9e7da381524c','a9e19eab-dee6-45af-ad73-6c19267fa05f'), -- Broccoli/Cauli/Spring Greens -> Cauliflower Florets, Steamed
  ('68f3d6c1-aba6-4ffd-a2d4-2b923e1901d9','dcd910cf-856d-4d9c-bb07-78ff3485af2b'), -- Tikka Masala -> Caramelised Onion PS
  ('7088db7b-977e-4650-a918-12e9185d0ff3','dcd910cf-856d-4d9c-bb07-78ff3485af2b'), -- Couscous, Cooked -> Caramelised Onion PS
  ('3dad43a2-c9e0-4ee9-ac41-31c146686224','e60652aa-a41a-4ea2-ac53-18673a9e9781'), -- Tikka Masala -> Chickpease Cooked PS
  ('ff43971a-77ce-4d6a-85ab-ab2a64fbb57f','82989384-ae1d-4790-bab3-57a7140ed752'), -- Tikka Masala -> Roasted Cauliflower (MF-P159)
  ('fe000b62-aaab-4175-ae5f-0771e1eb9bb5','0a0dd8e6-e6de-453c-a4aa-3fe0a3b237ef'), -- Sweet Potato/Cavolo Nero -> White Quinoa Cooked
  ('25e74e23-771a-4af2-a05d-18ef8d02767c','d04fd541-a68e-43c6-9081-d6ac3fdc0ac3'), -- Marinara Sauce -> Roasted Red Peppers
  ('40c167d8-70d2-444c-8fc0-2ad6337895b4','85714236-5708-45dc-a97d-296284701104'), -- Wild Rice Peppers Squash -> Roasted Butternut Squash
  ('1668b1d5-e128-4406-82b5-4c3688ab8fbd','625127c6-0f60-463f-81bb-3bda1a9c2b95'), -- Peppercorn Sauce -> New Gravy
  ('7c7948e7-de93-4405-92a5-b5e5c74513bd','54225aba-efa0-4192-8ee9-7b7b38e2bd12'), -- Tenderstem & Broccoli -> Broccoli Steamed
  ('a861f5c8-f4ff-49c6-ac15-554108bc5a35','032cc80c-dab0-4efd-b509-2a28c48d42ba'), -- Korean Spicy Beef -> Korean BBQ Sauce
  ('9dafee81-a08b-4a35-a954-ae31501ced42','032cc80c-dab0-4efd-b509-2a28c48d42ba'), -- Vermicelli in BBQ Sauce -> Korean BBQ Sauce
  ('9192e412-f093-4d56-9e75-1a2334fc9ed9','d060ef30-f940-4cd3-954d-c2fcfa41ca69'), -- Thai Green Curry Sauce -> Courgette, Sliced
  ('83fa36f7-5919-4f41-aa5a-3de5f05dabde','d060ef30-f940-4cd3-954d-c2fcfa41ca69'), -- Aubergine chermoula -> Courgette, Sliced
  ('a4895331-4938-42e6-b819-1fed051a5faf','c8d4f50f-b265-4c61-98a7-08123eb7ad25'), -- Marinara Sauce -> Carrots Diced, Steamed
  ('e9ca0c43-d898-4a0e-9a4c-05c4c246aeca','c8d4f50f-b265-4c61-98a7-08123eb7ad25'), -- New Gravy -> Carrots Diced, Steamed
  ('ea396e41-2285-4808-8808-7a0276f79c53','3a85112d-442e-4e71-a2a3-26c9cd9a037b'), -- Satay Chicken -> Grilled Chicken Breast PS
  ('c61f8b93-4b14-44e2-8804-d849fad8e4d1','3a85112d-442e-4e71-a2a3-26c9cd9a037b') -- Shawarma Chicken -> Grilled Chicken Breast PS
) as v(ing, target)
where i.id = v.ing::uuid;
