insert into auth.users
  (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change,
   email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select
  '00000000-0000-0000-0000-000000000000', persona.id, 'authenticated', 'authenticated', null,
  '{"provider":"web3","providers":["web3"]}',
  jsonb_build_object('address', persona.address), now() - persona.age, now() - persona.age,
  '', '', '', '', '', '', '', ''
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, '5Zx9qWpNvA3rTcYuJ2hKdEfGmSbQ7wXyRt6PnLkVzHa', interval '90 days'),
  ('10000000-0000-4000-8000-000000000002'::uuid, '8Yb3nMcQfRtKpZ2wVxJ5hLdSgEa7uWqPr9YkNzXt4Bv', interval '82 days'),
  ('10000000-0000-4000-8000-000000000003'::uuid, '3Wa7kPmZnQxRcVt2YfJ6hEdLgSbUq8wYrPk5NzMtXv9', interval '70 days'),
  ('10000000-0000-4000-8000-000000000004'::uuid, '6Vc4mNbXpQzRfKt3YgJ7hFdMgTcVr9xZsPl5NwKtYu2', interval '60 days'),
  ('10000000-0000-4000-8000-000000000005'::uuid, '9Tb5nPcYqRzSgLu4ZhK8jGeNhUdWs2yAtQm6PxLvZw3', interval '45 days'),
  ('10000000-0000-4000-8000-000000000006'::uuid, '2Ud6pQdZrSaThMv5AiL9kHfPiVeXt3zBuRn7QyMwAx4', interval '30 days')
) as persona(id, address, age)
on conflict (id) do nothing;

insert into public.profiles (id, wallet_address, username, bio, avatar_url, created_at)
values
  ('10000000-0000-4000-8000-000000000001', '5Zx9qWpNvA3rTcYuJ2hKdEfGmSbQ7wXyRt6PnLkVzHa', 'solara',
   'Generative artist chasing light. Devnet-native drops — every item is a real Core asset.',
   'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=solara', now() - interval '90 days'),
  ('10000000-0000-4000-8000-000000000002', '8Yb3nMcQfRtKpZ2wVxJ5hLdSgEa7uWqPr9YkNzXt4Bv', 'lumen_labs',
   'On-chain relics and sun-worn artifacts. Small batches, high polish.',
   'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=lumen', now() - interval '82 days'),
  ('10000000-0000-4000-8000-000000000003', '3Wa7kPmZnQxRcVt2YfJ6hEdLgSbUq8wYrPk5NzMtXv9', 'nova',
   'Experiments in the dark. Void Fragments are in review — get on the list.',
   'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=nova', now() - interval '70 days'),
  ('10000000-0000-4000-8000-000000000004', '6Vc4mNbXpQzRfKt3YgJ7hFdMgTcVr9xZsPl5NwKtYu2', 'orbit',
   'Collector. Floor sweeper. Diamond hands (mostly).',
   'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=orbit', now() - interval '60 days'),
  ('10000000-0000-4000-8000-000000000005', '9Tb5nPcYqRzSgLu4ZhK8jGeNhUdWs2yAtQm6PxLvZw3', 'vega',
   'Buying art I like. Occasionally flipping art I do not.',
   'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=vega', now() - interval '45 days'),
  ('10000000-0000-4000-8000-000000000006', '2Ud6pQdZrSaThMv5AiL9kHfPiVeXt3zBuRn7QyMwAx4', 'ceres_eth',
   'Long-term holder. Here for the 1/1s.',
   'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=ceres', now() - interval '30 days')
on conflict (id) do update set
  wallet_address = excluded.wallet_address,
  username = excluded.username,
  bio = excluded.bio,
  avatar_url = excluded.avatar_url;

insert into public.follows (follower_id, followee_id, created_at)
values
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', now() - interval '40 days'),
  ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', now() - interval '38 days'),
  ('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', now() - interval '25 days'),
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', now() - interval '30 days'),
  ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', now() - interval '18 days'),
  ('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000002', now() - interval '15 days'),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', now() - interval '50 days'),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', now() - interval '20 days'),
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', now() - interval '48 days')
on conflict do nothing;

insert into public.launch_applications
  (creator_id, name, description, website, twitter, metadata_source,
   supply, mint_price_lamports, royalty_bps, per_wallet_limit, reveal_mode, phases, status)
values
  ('10000000-0000-4000-8000-000000000003', 'Void Fragment',
   'A run of shards, revealed 48h after mint-out.',
   'https://void.example', '@nova', 'Arweave',
   500, 3100000000, 1000, 3, 'delayed',
   '[{"name":"Allowlist","price_sol":2.8,"limit":2},{"name":"Public","price_sol":3.1,"limit":3}]'::jsonb,
   'pending');
