-- Make the trending stats refreshable per collection, so the mint and settlement flows can keep
-- `stat_*` current instead of leaving every collection frozen at whatever the seed computed.
--
-- Before this, `refresh_collection_stats()` recomputed every collection at once and was only ever
-- called from seed.sql. A collection minted afterwards kept the column defaults — volume 0, delta
-- 0, sparkline '[]' — which is why its trend cell rendered empty.
--
-- Same body as the original, plus a `p_collection` filter (null = all, so the seed's no-arg call
-- still resolves). Invoker rights on purpose: RLS is the authorization. `authenticated` may update
-- only its own collections ("creators can update their own collections"), which is exactly the
-- mint case; settlement runs as service_role and bypasses RLS.

drop function if exists public.refresh_collection_stats();

create or replace function public.refresh_collection_stats(p_collection uuid default null)
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
    where p_collection is null or c2.id = p_collection
    group by c2.id
  ) s
  where s.id = c.id;
$$;

-- Mint (client-side, as the creator) and settlement (service role) both call this.
grant execute on function public.refresh_collection_stats(uuid) to authenticated, service_role;
