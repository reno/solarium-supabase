-- Solarium schema — baseline.
--
-- Ownership and settlement live on-chain; these tables are the off-chain layer:
-- profiles/social graph (source of truth) and nft/listing rows (cache of chain state).
--
-- This file and the twelve that follow replace the original incremental history. They are
-- grouped one-per-table in dependency order, and each carries its table's columns, indexes,
-- RLS policies and triggers. Every grant and revoke in the schema lives in one place —
-- 20260808001200_grants.sql — so the Data API privilege surface can be audited in one read.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-create a profile row when a wallet signs in for the first time.
-- The wallet address location in metadata depends on the auth provider payload,
-- so fall back to null and let the client fill it in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, wallet_address)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'address',
      new.raw_user_meta_data -> 'custom_claims' ->> 'address'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
