-- Generative collection model (match the design). A collection is a supply of *unique* 1/1
-- items — not numbered editions of one artwork. The design has no "edition of N" concept:
-- items carry their own art, traits, and rarity. So the "of N" total goes away; the per-item
-- number stays (an item's mint index within its collection, e.g. "Eclipse Pass #3").
--
--   drop nfts.edition_total       — there is no edition run
--   keep nfts.edition_number      — repurposed as the item's number in the collection
--
-- Collection "supply" is just the count of its items; the app already shows "N items".

alter table public.nfts drop column if exists edition_total;

comment on column public.nfts.edition_number is
  'Item number within its collection (mint index), e.g. 3 → "Name #3". Null for a standalone 1/1.';
