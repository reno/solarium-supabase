create policy "users can delete their own comments" on public.comments for delete using (auth.uid() = profile_id);
