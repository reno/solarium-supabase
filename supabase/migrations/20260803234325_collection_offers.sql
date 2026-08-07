-- Collection offers (D§4 "collection offer"): a bid on ANY item in a collection, with a quantity.
-- An offer now targets EITHER a specific nft OR a whole collection (with quantity N). Soft, like
-- all offers (#10) — no escrow. When an owner accepts a collection offer from one of their items,
-- the settle function binds the offer to that item (sets nft_id) and marks it accepted, after which
-- the normal complete flow runs unchanged.

alter table public.offers alter column nft_id drop not null;
alter table public.offers add column collection_id uuid references public.collections (id) on delete cascade;
alter table public.offers add column quantity integer not null default 1 check (quantity >= 1);

-- Exactly one target: an item offer (nft_id) or a collection offer (collection_id), never both/neither.
alter table public.offers add constraint offers_one_target check (
  (nft_id is not null and collection_id is null) or (nft_id is null and collection_id is not null)
);

-- One standing active collection offer per (collection, bidder) — mirrors the per-nft rule.
create unique index offers_one_active_collection_per_bidder
  on public.offers (collection_id, bidder_id) where (status = 'active' and collection_id is not null);
create index offers_collection_idx on public.offers (collection_id);
