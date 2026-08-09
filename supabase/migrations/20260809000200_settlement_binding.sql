-- Settlement binding — make a settlement signature single-use, and bind it to the transaction
-- the marketplace actually built.
--
-- verifySettlement() proved that a payment *happened*: it checked that the buyer's wallet paid
-- the fee, that the seller's balance rose by at least the price, and that the account key list
-- mentioned the asset. It never proved the payment was *this sale*. Nothing decoded an
-- instruction, nothing required a Core transfer to be present, and nothing tied the confirmed
-- signature to the transaction `prepare` had built and signed. Two consequences:
--
--   * Replay. No column anywhere recorded a signature as used — no unique index on
--     listings.sale_tx, offers.accepted_tx or activities.tx_signature. One payment naming ten
--     asset addresses as read-only keys could be submitted to `confirm` ten times, once per
--     listing, and each check would pass independently against the same transaction.
--   * Wash trading. Move an asset between two wallets you control, then submit any transaction
--     that merely mentions its address. The listing flips to sold at whatever price the row
--     says, for the cost of the 1% fee.
--
-- The fix binds by *message hash* rather than by decoding instructions. `prepare` records the
-- sha256 of the exact serialized transaction message it signed; `confirm` re-hashes the message
-- of the confirmed transaction and demands a match. That is a strictly stronger guarantee than
-- instruction decoding — every instruction, account, ordering and lamport amount must be
-- byte-identical to what we built — and it sidesteps the address-lookup-table problem entirely,
-- because raw message bytes are compared rather than the statically-listed account keys that
-- getTransaction returns (an ALT-compressed transaction hides its addresses in
-- meta.loadedAddresses, which the old check never consulted; a legitimate buyer whose wallet
-- compressed the transaction got a permanent 409 *after paying*).
--
-- It also fixes the mid-flight reprice: the intent carries the price that was quoted, so a
-- seller who raises price_lamports during the confirm window can no longer strand a buyer who
-- has already paid.

-- ---------------------------------------------------------------------------
-- Signature uniqueness
-- ---------------------------------------------------------------------------
-- Partial, because these columns are null until settlement closes the row. This alone kills the
-- replay, independently of everything below it.

create unique index listings_sale_tx_key
  on public.listings (sale_tx) where sale_tx is not null;

create unique index offers_accepted_tx_key
  on public.offers (accepted_tx) where accepted_tx is not null;

-- Keyed on (tx_signature, nft_id) rather than the signature alone: a buyer may legitimately mint
-- several items in one transaction and have candy-mint record each of them, and those rows share
-- a signature. What must not happen twice is the same item being recorded from the same tx.
create unique index activities_tx_signature_key
  on public.activities (tx_signature, nft_id) where tx_signature is not null;

-- ---------------------------------------------------------------------------
-- settlement_intents
-- ---------------------------------------------------------------------------
-- One row per transaction `prepare` hands out. Service-role only: RLS is enabled with no
-- policies and no grants, so PostgREST exposes nothing here.

create table public.settlement_intents (
  id uuid primary key default gen_random_uuid(),
  -- sha256 (hex) of the serialized transaction message that prepare built and signed. The
  -- binding key: confirm looks the intent up by re-hashing the confirmed transaction.
  message_hash text not null,
  listing_id uuid references public.listings (id) on delete cascade,
  offer_id uuid references public.offers (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  nft_id uuid not null references public.nfts (id) on delete cascade,
  -- The quoted split, captured at prepare time. confirm records the sale at *these* numbers,
  -- never at whatever the listing row says by then.
  price_lamports bigint not null check (price_lamports > 0),
  fee_lamports bigint not null default 0 check (fee_lamports >= 0),
  royalty_lamports bigint not null default 0 check (royalty_lamports >= 0),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  buyer_wallet text not null,
  asset_address text not null,
  consumed_at timestamptz,
  consumed_tx text,
  created_at timestamptz not null default now(),
  -- An intent is a quote; it should not be redeemable indefinitely. Solana blockhashes expire
  -- in roughly 60-90s, so the transaction is unusable long before this — the window exists to
  -- bound the table, not to be load-bearing.
  expires_at timestamptz not null default now() + interval '1 hour',
  constraint settlement_intents_one_target check ((listing_id is null) <> (offer_id is null))
);

create unique index settlement_intents_message_hash_key
  on public.settlement_intents (message_hash);
create index settlement_intents_listing_idx on public.settlement_intents (listing_id);
create index settlement_intents_offer_idx on public.settlement_intents (offer_id);
-- Sweeping expired, unconsumed quotes.
create index settlement_intents_expiry_idx
  on public.settlement_intents (expires_at) where consumed_at is null;

alter table public.settlement_intents enable row level security;

comment on table public.settlement_intents is
  'One row per settlement transaction handed out by settle/prepare. Binds a confirmed signature '
  'to the exact message the marketplace built, and pins the quoted price so a mid-flight reprice '
  'cannot strand a buyer who has already paid. Service role only — no policies, no grants.';

-- ---------------------------------------------------------------------------
-- record_settled_sale
-- ---------------------------------------------------------------------------
-- The post-verification writes used to be a sequence of unconditional read-then-writes: only
-- the first (the listing CAS) was guarded, and the NFT owner update and the activity insert
-- that followed were not, with no transaction around any of it. A crash between them left the
-- listing sold and the NFT still owned by the seller, with no repair path.
--
-- Doing it in one function makes it one transaction: either the whole sale is recorded or none
-- of it is. The CAS predicates are kept inside so that concurrent confirms still resolve to a
-- single winner.

create or replace function public.record_settled_sale(
  p_intent_id uuid,
  p_signature text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.settlement_intents;
  v_rows int;
  v_listing_id uuid;
  v_seller_id uuid;
  v_buyer_wallet text;
begin
  -- Claim the intent. This is the idempotency anchor: exactly one caller wins, and a repeat of
  -- the same signature is reported as already-recorded rather than settling twice.
  update public.settlement_intents
     set consumed_at = now(), consumed_tx = p_signature
   where id = p_intent_id and consumed_at is null
  returning * into v_intent;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  v_buyer_wallet := v_intent.buyer_wallet;
  v_seller_id := v_intent.seller_id;

  if v_intent.offer_id is not null then
    update public.offers
       set status = 'accepted', accepted_tx = p_signature
     where id = v_intent.offer_id and status = 'accepted' and accepted_tx is null;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'offer % is no longer awaiting settlement', v_intent.offer_id
        using errcode = 'check_violation';
    end if;

    select id into v_listing_id
      from public.listings
     where nft_id = v_intent.nft_id and status = 'active'
     limit 1;
  else
    v_listing_id := v_intent.listing_id;
  end if;

  if v_listing_id is not null then
    update public.listings
       set status = 'sold', buyer_id = v_intent.buyer_id, sale_tx = p_signature
     where id = v_listing_id and status = 'active';
    get diagnostics v_rows = row_count;
    -- A direct listing purchase must close its listing; an offer settlement is allowed to find
    -- the listing already gone, since acceptance is what bound the sale.
    if v_rows = 0 and v_intent.offer_id is null then
      raise exception 'listing % is no longer active', v_listing_id
        using errcode = 'check_violation';
    end if;
  end if;

  update public.nfts
     set owner_id = v_intent.buyer_id, owner_wallet = v_buyer_wallet
   where id = v_intent.nft_id;

  insert into public.activities (type, nft_id, actor_id, counterparty_id, lamports, tx_signature)
  values ('sale', v_intent.nft_id, v_intent.buyer_id, v_seller_id, v_intent.price_lamports, p_signature)
  on conflict (tx_signature, nft_id) where tx_signature is not null do nothing;

  return true;
end;
$$;

revoke execute on function public.record_settled_sale(uuid, text) from public, anon, authenticated;
grant execute on function public.record_settled_sale(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Integrity constraints the app already assumed
-- ---------------------------------------------------------------------------

-- reveal builds Map<item_number, …> over a collection's items, and collection_item_rarity is
-- keyed on (collection_id, item_number). Duplicates silently dropped items from the reveal.
create unique index nfts_collection_item_number_key
  on public.nfts (collection_id, item_number)
  where collection_id is not null and item_number is not null;

-- An offer could be inserted already expired, or expiring in the year 3000. Checked as a
-- trigger rather than a CHECK constraint because now() is not immutable.
create or replace function public.enforce_offer_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expires_at <= now() then
    raise exception 'offer expiry must be in the future' using errcode = 'check_violation';
  end if;
  if new.expires_at > now() + interval '365 days' then
    raise exception 'offer expiry must be within a year' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger offers_check_expiry
  before insert on public.offers
  for each row execute function public.enforce_offer_expiry();
