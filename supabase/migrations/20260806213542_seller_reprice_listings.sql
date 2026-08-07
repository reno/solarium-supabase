-- Let a seller change the price of a listing they already have up.
--
-- Until now the only update a seller could make was cancelling: the policy's WITH CHECK demanded
-- the resulting row be 'cancelled', so a price change was rejected by RLS. Repricing meant cancel
-- + relist, which costs two wallet signatures (the transfer delegate is removed and re-granted)
-- for what is purely an off-chain number. That is also why adding a launchpad mint phase left
-- every listed item at its old price — nothing in the app could move it.
--
-- Price lives only in Postgres (see AGENTS.md: listings are off-chain, settlement reads the row),
-- so repricing needs no chain action at all. The delegate already granted at listing time stays
-- valid, and settlement builds the payment from the current row.

-- Columns first: the existing table-level UPDATE grant would let a seller rewrite anything on
-- their own row once the policy allows an active→active update — including buyer_id and sale_tx,
-- which belong to settlement. A column list is what actually contains this; the policy below only
-- decides which rows.
revoke update on table public.listings from authenticated;
grant update (status, price_lamports, expires_at) on public.listings to authenticated;

drop policy "sellers can cancel their own listings" on public.listings;

-- Sellers may cancel, or reprice while leaving the listing active. Marking sold is still
-- settlement's job (service role, which bypasses RLS).
create policy "sellers can cancel or reprice their own listings"
  on public.listings for update
  using (auth.uid() = seller_id and status = 'active')
  with check (auth.uid() = seller_id and status in ('active', 'cancelled'));
