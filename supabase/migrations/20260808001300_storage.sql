-- Storage buckets. Media and metadata JSON are public; the on-chain metadata URIs point here.
-- Uploads are namespaced by user id: <bucket>/<auth.uid()>/...

insert into storage.buckets (id, name, public)
values
  ('nft-media', 'nft-media', true),   -- images + metadata JSON; on-chain URIs point here
  ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "public read of nft media"
  on storage.objects for select using (bucket_id in ('nft-media', 'avatars'));

create policy "users upload to their own folder"
  on storage.objects for insert with check (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Overwriting an object at a path you already own (supabase-js `upsert: true`) is an UPDATE on
-- storage.objects, not an INSERT. Without this policy every re-upload of an avatar or a
-- regenerated metadata JSON fails RLS.
create policy "users overwrite their own objects"
  on storage.objects for update
  using (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users manage their own objects"
  on storage.objects for delete using (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
  );
