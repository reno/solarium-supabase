-- Collection banner URL (distinct from cover/avatar).
-- Design calls for a 6:1 banner image separate from the 1:1 cover/avatar.

alter table public.collections add column if not exists banner_url text;

comment on column public.collections.banner_url is 'Banner image URL (6:1 aspect ratio), distinct from the 1:1 cover avatar';
