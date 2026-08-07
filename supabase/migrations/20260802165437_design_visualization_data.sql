-- Visualization data model. Per product direction, the app is now a design showcase:
-- these columns back the design kit's widgets (trait rarity, trending stats, sparklines)
-- and existing rows are backfilled with ARBITRARY values. Nothing here is authoritative —
-- on-chain state (ownership, settlement) remains the source of truth for real actions.

-- NFT traits + rarity (drive RarityBadge, the traits grid, RarityDistribution, FilterRail).
alter table public.nfts add column if not exists traits jsonb not null default '[]'::jsonb;
alter table public.nfts add column if not exists rarity_rank integer;
alter table public.nfts add column if not exists rarity_total integer;

-- Collection display stats (drive the trending table, stats bars, sparklines, verified tick).
alter table public.collections add column if not exists verified boolean not null default false;
alter table public.collections add column if not exists stat_volume_lamports bigint not null default 0;
alter table public.collections add column if not exists stat_delta_bps integer not null default 0; -- signed 24h change
alter table public.collections add column if not exists stat_sparkline jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Backfill arbitrary values (visualization only).
-- ---------------------------------------------------------------------------

update public.nfts set
  rarity_total = 8192,
  rarity_rank = 1 + floor(random() * 8192)::int,
  traits = jsonb_build_array(
    jsonb_build_object('trait', 'Background', 'value', (array['Solar','Eclipse','Void','Corona'])[1 + floor(random() * 4)::int]),
    jsonb_build_object('trait', 'Eyes',       'value', (array['Laser','Visor','Closed'])[1 + floor(random() * 3)::int]),
    jsonb_build_object('trait', 'Frame',      'value', (array['Titanium','Carbon'])[1 + floor(random() * 2)::int]),
    jsonb_build_object('trait', 'Aura',       'value', (array['None','Ember','Halo','Storm'])[1 + floor(random() * 4)::int])
  );

update public.collections c set
  verified = (random() < 0.65),
  stat_volume_lamports = (floor(random() * 1800 + 80) * 1000000000)::bigint,
  stat_delta_bps = (floor(random() * 4200) - 1200)::int,   -- roughly -12% .. +30%
  stat_sparkline = (
    select jsonb_agg(round((3 + sin((g + (('x' || substr(md5(c.id::text), 1, 4))::bit(16)::int) % 7) / 2.0) + random() * 0.8)::numeric, 3))
    from generate_series(0, 13) g
  );
