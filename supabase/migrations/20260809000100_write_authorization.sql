-- Write authorization — close the insert-time holes left by table-level INSERT grants.
--
-- 20260808001200_grants.sql narrowed the UPDATE grants per column and explained, in comments,
-- exactly why: `verified` is the vetting badge, `buyer_id`/`sale_tx` belong to settlement,
-- `owner_id` moves only on chain. Every one of those guards was bypassable, because the INSERT
-- grant sitting next to each of them was table-level and therefore covered all columns. A row
-- could simply be *born* in the state the UPDATE grant forbids it from reaching.
--
-- This migration makes INSERT match UPDATE. Three tools, chosen per table:
--   * column-level grants, where the client legitimately writes a known subset;
--   * WITH CHECK predicates, where a column must be pinned to a value rather than merely
--     withheld (a grant can stop you setting `status`, but only a check can require it be
--     'active' — an omitted column takes its default, which is what we want, but a check is
--     what makes that guarantee rather than a convention);
--   * outright revocation, where the client never writes the table at all.
--
-- Column grants mean any column NOT listed must have a usable default or the insert fails.
-- Each grant below was written against the actual insert payloads in lib/ — see the notes.

-- ---------------------------------------------------------------------------
-- activities — the market-data forgery
-- ---------------------------------------------------------------------------
-- collection_market_stats sums `lamports` filtered on type='sale' and windowed on created_at.
-- With a table-level insert grant, all three of those were client-chosen: anyone could mint
-- fabricated sales at any price and any backdated timestamp, and because there is no DELETE
-- policy on this table, the rows would be permanent.
--
-- The client legitimately writes only list/delist/bid rows, and only ever names
-- (type, nft_id, actor_id, lamports) — verified against lib/listings/listings.ts and
-- lib/offers/offers.ts. So: withhold created_at and tx_signature via the column grant (they
-- take their defaults / stay null), and pin `type` to the client-authored kinds via the policy.
-- 'sale' and 'mint' rows are now writable only by the service role, which is the only thing
-- that has actually verified a transaction.

revoke insert on table public.activities from authenticated;
grant insert (type, nft_id, actor_id, lamports) on table public.activities to authenticated;

drop policy if exists "users can record their own activities" on public.activities;
create policy "users can record their own activities"
  on public.activities for insert with check (
    auth.uid() = actor_id
    -- 'sale' and 'mint' are settlement's to write: they are the types the stats views count,
    -- and the only writer that has verified a transaction is the service role.
    and type in ('list', 'delist', 'bid')
  );

-- ---------------------------------------------------------------------------
-- nfts — cross-collection insertion
-- ---------------------------------------------------------------------------
-- The insert policy checked `auth.uid() = creator_id` and never looked at collection_id, so a
-- user could insert an item into anyone's collection, self-assigning owner_id, item_number,
-- traits and rarity_rank — enough to put a rank-1 item inside a verified collection and list it.
--
-- No app code inserts or updates this table: mints are recorded by the candy-mint edge function
-- (service role), which re-derives them from the chain. Ownership moves only through settle.
-- So the grants go away entirely rather than being narrowed — there is nothing to narrow them to.
-- The policies are left in place: they cost nothing and describe the intent if a grant ever
-- returns.

revoke insert on table public.nfts from authenticated;
revoke update (rarity_rank, rarity_total) on table public.nfts from authenticated;

-- The insert policy still gets the collection-ownership predicate it always should have had, so
-- that a future grant cannot silently reopen the hole.
drop policy if exists "creators can record their own mints" on public.nfts;
create policy "creators can record their own mints"
  on public.nfts for insert with check (
    auth.uid() = creator_id
    and (
      collection_id is null
      or exists (
        select 1 from public.collections c
        where c.id = collection_id and c.creator_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- collections — self-verification
-- ---------------------------------------------------------------------------
-- `verified` is excluded from the UPDATE grant so a creator cannot self-award the badge; the
-- table-level INSERT grant handed it straight back, since a collection could be created with
-- verified = true. createLaunch() writes exactly the columns below (it supplies its own `id`,
-- generated client-side so the wizard's storage uploads and the row agree on a folder).

revoke insert on table public.collections from authenticated;
grant insert (id, creator_id, name, description, cover_url, banner_url, royalty_bps, reveal_at)
  on table public.collections to authenticated;

-- Belt and braces: even if the grant is ever widened, a creator cannot create a verified row.
drop policy if exists "creators can insert their own collections" on public.collections;
create policy "creators can insert their own collections"
  on public.collections for insert with check (
    auth.uid() = creator_id
    and verified = false
  );

-- ---------------------------------------------------------------------------
-- listings — fabricated sales
-- ---------------------------------------------------------------------------
-- buyer_id and sale_tx are kept out of the seller's reach by the UPDATE grant, but a listing
-- could be inserted already status='sold' with a fabricated sale_tx and any victim as buyer.
-- listings_one_active_per_nft is a *partial* index (status='active'), so there was no limit on
-- how many fake sold rows a single NFT could accumulate.

revoke insert on table public.listings from authenticated;
grant insert (nft_id, seller_id, price_lamports, expires_at)
  on table public.listings to authenticated;

drop policy if exists "sellers can list their own nfts" on public.listings;
create policy "sellers can list their own nfts"
  on public.listings for insert with check (
    auth.uid() = seller_id
    and exists (
      select 1 from public.nfts
      where nfts.id = nft_id and nfts.owner_id = auth.uid()
    )
    -- A listing may only be born active and unsold. Settlement is the only thing that closes one.
    and status = 'active'
    and buyer_id is null
    and sale_tx is null
  );

-- ---------------------------------------------------------------------------
-- offers — insert-time acceptance, and the one WITH CHECK that forgot its owner
-- ---------------------------------------------------------------------------
-- Two separate holes. The table-level INSERT grant let a bidder create a row already
-- status='accepted' with a fabricated accepted_tx. And the update policy's WITH CHECK asserted
-- only `status = 'cancelled'` without re-asserting bidder_id — the single policy in the schema
-- that does not re-check ownership on the check side — so a cancel statement could also hand the
-- row to another bidder, reprice it, re-point its nft_id, or write accepted_tx, all under the
-- table-level UPDATE grant.

revoke insert, update on table public.offers from authenticated;
grant insert (nft_id, collection_id, bidder_id, price_lamports, quantity, expires_at)
  on table public.offers to authenticated;
-- Cancelling is the only update a bidder makes; status is the only column it touches.
grant update (status) on table public.offers to authenticated;

drop policy if exists "bidders can place offers" on public.offers;
create policy "bidders can place offers"
  on public.offers for insert with check (
    auth.uid() = bidder_id
    and not exists (
      select 1 from public.nfts
      where nfts.id = nft_id and nfts.owner_id = auth.uid()
    )
    and status = 'active'
    and accepted_tx is null
  );

drop policy if exists "bidders can cancel their own offers" on public.offers;
create policy "bidders can cancel their own offers"
  on public.offers for update
  using (auth.uid() = bidder_id and status = 'active')
  -- Re-asserting bidder_id is the point: a USING-only ownership test says which rows you may
  -- touch, not who they may belong to afterwards.
  with check (auth.uid() = bidder_id and status = 'cancelled');

-- ---------------------------------------------------------------------------
-- profiles — wallet impersonation
-- ---------------------------------------------------------------------------
-- wallet_address is the user's identity, and it was freely settable to any address not already
-- taken. Beyond rendering as someone else everywhere, app/launchpad/[id] matches the signed-in
-- user's own profile.wallet_address against launchpad_allowlist, so an allowlist phase would
-- open in the UI for anyone who claimed an allowlisted address.
--
-- The column now comes from the verified JWT claim and nowhere else (see the trigger below),
-- so it is dropped from the client's grants entirely. A BEFORE trigger may still assign it —
-- column privileges constrain the columns a *statement* names, not what a trigger does.

revoke insert, update on table public.profiles from authenticated;
grant insert (id, username, bio, avatar_url) on table public.profiles to authenticated;
-- `id` is in the UPDATE list only because PostgREST's upsert needs it there. An upsert compiles
-- to `on conflict (id) do update set ...` covering *every* column in the request body, the
-- conflict target included, so without this the profile form fails outright on a row that
-- already exists — which, after handle_new_user, is every row. It grants nothing: the update
-- policy's `with check (auth.uid() = id)` means the only value it can ever be set to is the one
-- it already holds.
grant update (id, username, bio, avatar_url) on table public.profiles to authenticated;

-- Bind wallet_address to the address the wallet actually proved at sign-in.
--
-- Supabase web3 sign-in puts it at user_metadata.custom_claims.address (verified against the
-- live project: every auth.users row carries it there, and every profile already matches).
-- handle_new_user reads the same pair of paths from raw_user_meta_data at signup; this covers
-- the case that one was written to fall back on — a provider payload that did not carry the
-- address, which left the client to fill the column in.
--
-- Once bound the value is immutable: it is an identity, and re-pointing it is the attack.
-- Invoker rights on purpose: this function reads the caller's own JWT and assigns to NEW. It
-- touches no table, so it needs no privilege of its own.
create or replace function public.enforce_profile_wallet()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_claim text;
begin
  -- No end-user session: the service role, and handle_new_user running in the auth service's
  -- context, both write this column legitimately and are left alone.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.wallet_address is not null then
    new.wallet_address := old.wallet_address;
    return new;
  end if;

  v_claim := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'address',
    auth.jwt() -> 'user_metadata' -> 'custom_claims' ->> 'address'
  );
  -- Null claim leaves the column null rather than trusting the client's value. A profile with
  -- no wallet cannot buy or sell (settle refuses it), which is the safe direction to fail.
  new.wallet_address := v_claim;
  return new;
end;
$$;

revoke execute on function public.enforce_profile_wallet() from public, anon, authenticated;

create trigger profiles_enforce_wallet
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_wallet();

-- ---------------------------------------------------------------------------
-- candy_machines — fake scarcity
-- ---------------------------------------------------------------------------
-- items_available/items_loaded/items_redeemed and prefix_uri are documented as caches of chain
-- state, but the table-level grants let a creator write them freely: fake a nearly-sold-out
-- drop on the launchpad page, or re-home every item's metadata by rewriting prefix_uri (which
-- candy-mint also uses to bound the URI it will fetch).
--
-- The deploy flow in lib/launchpad/candy-machine.ts writes every column except items_redeemed
-- at insert, and only items_loaded thereafter as it batches config lines.

revoke insert, update on table public.candy_machines from authenticated;
grant insert (collection_id, candy_machine_address, candy_guard_address, authority_wallet,
              items_available, items_loaded, prefix_name, prefix_uri, deploy_tx)
  on table public.candy_machines to authenticated;
grant update (items_loaded) on table public.candy_machines to authenticated;
