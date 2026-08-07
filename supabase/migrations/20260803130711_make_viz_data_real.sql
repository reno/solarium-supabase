-- Make previously-fabricated visualization data real, computed from data we already have
-- (no new infrastructure). Covers punch-list #1 (rarity), #2 (trending), #6 (verified).
--
--   #1 rarity   → ranked from stored trait-value frequencies within each collection
--   #2 trending → collections.stat_* recomputed from `activities` (sale volume / 24h delta /
--                 14-day sparkline); plus a live `collection_market_stats` view for windowed volume
--   #6 verified → driven by an approved `launch_application` (vetting), not a random flag
--
-- These are helper functions + a view + a trigger; the seed calls the recompute functions after
-- it inserts rows, and the mint/sale flows can call them too. On-chain state still governs real
-- ownership/settlement — this only makes the *display* numbers honest.

-- ---------------------------------------------------------------------------
-- #1 Rarity: score each item by how uncommon its trait values are in its collection.
--   score = Σ over traits (values_seen_in_trait / times_this_value_appears)
--   rarest = highest score = rank 1. rarity_total = items in the collection.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_collection_rarity(p_collection uuid)
returns void
language sql
as $$
  with expanded as (
    select n.id as nft_id, t.obj->>'trait' as trait, t.obj->>'value' as value
    from public.nfts n
    cross join lateral jsonb_array_elements(n.traits) as t(obj)
    where n.collection_id = p_collection
  ),
  freq as (
    select trait, value,
           count(*)::numeric as cnt,
           sum(count(*)) over (partition by trait) as trait_total
    from expanded
    group by trait, value
  ),
  scored as (
    select n.id as nft_id, coalesce(sum(f.trait_total / f.cnt), 0) as score
    from public.nfts n
    left join expanded e on e.nft_id = n.id
    left join freq f on f.trait = e.trait and f.value = e.value
    where n.collection_id = p_collection
    group by n.id
  ),
  ranked as (
    select nft_id,
           row_number() over (order by score desc, nft_id) as rnk,
           count(*) over () as tot
    from scored
  )
  update public.nfts n
  set rarity_rank = r.rnk, rarity_total = r.tot
  from ranked r
  where r.nft_id = n.id;
$$;

-- ---------------------------------------------------------------------------
-- #2 Trending: recompute the display stat_* columns from real sale activity.
--   stat_volume_lamports → all-time sale volume
--   stat_delta_bps       → signed 24h-vs-previous-24h change, in basis points
--   stat_sparkline       → last 14 days of daily sale volume (SOL), oldest → newest
-- ---------------------------------------------------------------------------

create or replace function public.refresh_collection_stats()
returns void
language sql
as $$
  update public.collections c set
    stat_volume_lamports = s.vol_all,
    stat_delta_bps = case
      when s.vol_prev24 > 0 then round(((s.vol_24 - s.vol_prev24)::numeric / s.vol_prev24) * 10000)::int
      when s.vol_24 > 0 then 10000    -- brand-new volume with no prior baseline
      else 0
    end,
    stat_sparkline = s.sparkline
  from (
    select
      c2.id,
      coalesce(sum(a.lamports) filter (where a.type = 'sale'), 0)::bigint as vol_all,
      coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '24 hours'), 0)::bigint as vol_24,
      coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '48 hours' and a.created_at < now() - interval '24 hours'), 0)::bigint as vol_prev24,
      (
        select coalesce(jsonb_agg(round(day_vol, 3) order by day), '[]'::jsonb)
        from (
          select gs.day,
            coalesce((
              select sum(a3.lamports)::numeric / 1e9
              from public.activities a3
              join public.nfts n3 on n3.id = a3.nft_id
              where n3.collection_id = c2.id and a3.type = 'sale'
                and date_trunc('day', a3.created_at) = gs.day
            ), 0) as day_vol
          from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') as gs(day)
        ) days
      ) as sparkline
    from public.collections c2
    left join public.nfts n on n.collection_id = c2.id
    left join public.activities a on a.nft_id = n.id
    group by c2.id
  ) s
  where s.id = c.id;
$$;

-- Live windowed volume for the trending table's 24h / 7d / 30d range selects.
create or replace view public.collection_market_stats
with (security_invoker = true) as
  select
    c.id as collection_id,
    coalesce(sum(a.lamports) filter (where a.type = 'sale'), 0)::bigint as volume_all,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '24 hours'), 0)::bigint as volume_24h,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '7 days'), 0)::bigint as volume_7d,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '30 days'), 0)::bigint as volume_30d,
    count(*) filter (where a.type = 'sale') as sales_count
  from public.collections c
  left join public.nfts n on n.collection_id = c.id
  left join public.activities a on a.nft_id = n.id
  group by c.id;

grant select on table public.collection_market_stats to anon, authenticated;

-- ---------------------------------------------------------------------------
-- #6 Verified: a collection is verified when its creator has an approved launch
-- application (the vetting signal), replacing the random backfill flag.
-- ---------------------------------------------------------------------------

create or replace function public.sync_creator_verified()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.status = 'approved' then
    update public.collections set verified = true where creator_id = new.creator_id;
  end if;
  return new;
end;
$$;

create trigger launch_application_verified
  after insert or update of status on public.launch_applications
  for each row execute function public.sync_creator_verified();

-- Recompute the flag from real approvals (clears the random backfill; fresh installs have no
-- approvals yet, so everything starts unverified until an application is approved).
update public.collections set verified = false;
update public.collections c set verified = true
where exists (
  select 1 from public.launch_applications la
  where la.creator_id = c.creator_id and la.status = 'approved'
);

-- Edge functions (service role) may call the recompute helpers after settlement.
grant execute on function public.recompute_collection_rarity(uuid) to service_role;
grant execute on function public.refresh_collection_stats() to service_role;
