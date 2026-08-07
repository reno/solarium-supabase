-- Creator royalty as basis points on the collection (500 = 5.0%). Enforced OFF-CHAIN by
-- the settle edge function: because every Solarium sale settles through that function,
-- splitting the proceeds there is effectively enforced for on-platform trades. The buyer
-- pays the listed price; it's split into (price − royalty) to the seller and the royalty
-- to the collection creator's wallet, in the same atomic transaction. No marketplace fee.
--
-- Adding the column with a default backfills existing collections to 5%. Standalone NFTs
-- (no collection) carry no royalty.
alter table public.collections
  add column royalty_bps integer not null default 500
  check (royalty_bps between 0 and 10000);
