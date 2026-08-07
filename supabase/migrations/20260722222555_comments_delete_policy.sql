-- The identical policy is already created in the init migration; this standalone
-- migration is redundant. Guard it so a clean `db reset` doesn't fail with 42710.
drop policy if exists "users can delete their own comments" on public.comments;
create policy "users can delete their own comments" on public.comments for delete using (auth.uid() = profile_id);
