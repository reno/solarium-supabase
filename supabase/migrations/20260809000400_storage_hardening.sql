-- Storage hardening — bucket limits, and immutability for metadata that is already on chain.
--
-- Two problems, both in 20260808001300_storage.sql.
--
-- 1. The buckets were created with no allowed_mime_types and no file_size_limit, so only the
--    global 50 MiB cap applied and any content type was accepted. The upload path passes
--    `file.type` through verbatim, so `accept="image/*"` in the wizard was a file-picker hint
--    and nothing more. An SVG uploaded into the public nft-media bucket and referenced from a
--    collection cover is stored XSS on the storage origin.
--
-- 2. The UPDATE and DELETE policies were unconditionally true for everything under
--    <auth.uid()>/…, and a drop's folder is {creatorId}/{collectionId}. That folder holds the
--    `{n}.json` files the on-chain URIs point at. A creator could therefore sell out a drop and
--    then rewrite every item's art and attributes — the buyers' assets still point at the same
--    URLs, and nothing on chain or in the database records the swap. The same primitive let a
--    creator swap manifest.json between deploy and reveal, which is the file the reveal edge
--    function re-fetches at call time to decide what every item becomes.
--
-- The fix for (2) freezes a drop's folder at the moment it is deployed, rather than moving
-- deployed metadata to a second bucket. Deploy is exactly the point where the metadata stops
-- being the creator's private draft and starts being what buyers are purchasing, and it is
-- already recorded: a collection has a candy_machines row if and only if its machine exists.
-- Before that the wizard keeps full write access to its staging area; after it, the creator has
-- none. The reveal function runs as service_role, which bypasses RLS, so the delayed-reveal
-- rewrite still works — that is the one writer that is *supposed* to change these files, and it
-- can only write what the manifest already committed to.

-- ---------------------------------------------------------------------------
-- Bucket limits
-- ---------------------------------------------------------------------------
-- nft-media carries the metadata JSONs as well as the art, so application/json belongs here.
-- image/svg+xml deliberately does not: it is an executable document, and these buckets are
-- public and same-origin with nothing.

update storage.buckets
   set file_size_limit = 15728640,  -- 15 MiB
       allowed_mime_types = array[
         'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
         'application/json'
       ]
 where id = 'nft-media';

update storage.buckets
   set file_size_limit = 5242880,   -- 5 MiB
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
 where id = 'avatars';

-- ---------------------------------------------------------------------------
-- Deployed-drop immutability
-- ---------------------------------------------------------------------------

-- True once the collection whose id is the object's second path segment has a deployed candy
-- machine. Avatar paths are <uid>/<file>, so the segment is checked against the uuid shape
-- before casting rather than assuming it is one.
create or replace function public.is_deployed_drop_object(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.candy_machines cm
    where cm.collection_id = (
      case
        when coalesce((storage.foldername(object_name))[2], '') ~
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(object_name))[2])::uuid
      end
    )
  );
$$;

revoke execute on function public.is_deployed_drop_object(text) from public;
grant execute on function public.is_deployed_drop_object(text) to authenticated, service_role;

drop policy if exists "users overwrite their own objects" on storage.objects;
create policy "users overwrite their own objects"
  on storage.objects for update
  using (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
    and not public.is_deployed_drop_object(name)
  )
  with check (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
    and not public.is_deployed_drop_object(name)
  );

drop policy if exists "users manage their own objects" on storage.objects;
create policy "users manage their own objects"
  on storage.objects for delete using (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
    and not public.is_deployed_drop_object(name)
  );

-- Inserting a *new* object into a deployed folder is blocked too. Every path a deployed drop
-- reads from is written before or during deploy, so there is nothing legitimate left to add,
-- and leaving insert open would let a creator fill in an item that had been missing and change
-- what a buyer receives.
drop policy if exists "users upload to their own folder" on storage.objects;
create policy "users upload to their own folder"
  on storage.objects for insert with check (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
    and not public.is_deployed_drop_object(name)
  );

-- ---------------------------------------------------------------------------
-- Manifest pinning
-- ---------------------------------------------------------------------------
-- The hash of manifest.json as it stood at deploy. Writable only at insert — the column is
-- deliberately left out of the candy_machines UPDATE grant (which covers items_loaded alone),
-- so once the machine row exists the value is frozen, and by then so is the folder. That makes
-- it a real anchor rather than a self-attestation: reveal re-fetches manifest.json and can
-- confirm it is still byte-for-byte the file the drop was deployed from.

alter table public.candy_machines add column manifest_sha256 text;

comment on column public.candy_machines.manifest_sha256 is
  'sha256 (hex) of manifest.json at deploy time. Insert-only by the creator; reveal verifies '
  'the manifest it fetches against this before rewriting any item metadata.';

grant insert (manifest_sha256) on table public.candy_machines to authenticated;
