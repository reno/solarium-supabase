# Deploying Solarium to production (mainnet-beta)

Target: Solana **mainnet-beta**, real SOL, real NFTs. Read this whole doc before
running anything — step 0 is a structural decision that's expensive to undo later.

## 0. Environment strategy — use a separate Supabase project for mainnet

The schema (`supabase/migrations/`) has **no network/cluster column** on `nfts`,
`collections`, or `listings`. If the existing hosted project
(`xitjjgxpzksejjotelyi`, currently devnet, referenced in `.env.prod`) is reused for
mainnet, devnet test assets and real mainnet assets end up in the same tables with
no way to tell them apart — a settlement lookup could resolve a devnet mint address
as if it were real, or vice versa.

**Do this instead:**
- Keep the existing Supabase project as **devnet/staging** — no changes needed there.
- Create a **new Supabase project** for **mainnet/production**. Everything below
  targets that new project.
- Two Vercel environments: staging → devnet project + `devnet` cluster; production →
  new mainnet project + `mainnet-beta` cluster, on the real domain.

## 0b. What you need besides Supabase and Vercel

Short list, because it is shorter than people expect. One of these still fails
*silently* — no error, no log, just wrong output — which is the reason they're
written down.

| Thing | Required? | Why, and what breaks without it |
|---|---|---|
| Solana RPC endpoint (Helius) | **Yes** | Every chain read and write. Step 1. |
| Settlement authority keypair | **Yes** | A keypair you generate, not a service you sign up for. Step 2. Needs no balance. |
| Domain + HTTPS | **Yes** | SIWS validates the sign-in message URI against Auth's redirect allow-list. An `http://` origin, or one missing from step 3a's list, fails sign-in outright. |
| CoinGecko API | Optional; degrades loudly | `lib/price/sol.ts` fetches SOL/USD with `revalidate: 60`. Set `COINGECKO_API_KEY` (free **Demo** key) to get your own rate limit instead of sharing the keyless public tier by IP — see step 4. Every failure path still returns a **hardcoded `148.62`**, but now logs a `[sol-usd]` warning first, so a dead key is visible in Vercel runtime logs rather than silently serving a stale figure. Display only: lamport amounts, listings and settlement never touch this number. |
| jsDelivr CDN | Degrades silently | `components/design/core/Icon.tsx:5,21` fetches **every** icon at runtime from `cdn.jsdelivr.net`, and the failure handler is an empty `.catch(() => {})` (`:28`). If the CDN is blocked or down, icons simply don't render — no broken-image marker, no console error. |
| explorer.solana.com | Links only | Outbound `href`s built in `lib/solana/config.ts:39,43`. Nothing is fetched from it. |

Explicitly **not** needed, so nobody goes shopping for one:

- **No IPFS / Arweave / Irys / Pinata.** Media *and* metadata JSON live in Supabase
  Storage (`nft-media`, `_shared/manifest.ts:26`); on-chain URIs point straight at
  bucket URLs. This is a deliberate tradeoff — your Supabase project is the
  permanence guarantee for every drop's art. Migrating later means rewriting
  on-chain URIs, which candy-machine drops can't do after the fact.
- **No SMTP / email provider.** Auth is wallet-only (`[auth.email] enable_signup = false`);
  nothing in the app sends mail.
- **No analytics, Sentry, captcha, queue, or cron service.** The hcaptcha/SendGrid
  blocks in `config.toml` are commented-out CLI boilerplate.
- **No Docker in production.** It's a local-dev dependency (`supabase start`) only.

## 1. Helius — mainnet RPC endpoints

Create **two API keys** on your Helius mainnet project — don't reuse one for both
roles:

1. **Client key** (`NEXT_PUBLIC_SOLANA_RPC_URL`) — this URL ships in the browser
   bundle (it's a `NEXT_PUBLIC_*` var), so treat it as public. In the Helius
   dashboard, open the key's **access control** settings and restrict it by
   **allowed domains** to your production domain, so the URL is useless to anyone
   who copies it out of your JS bundle. Set a usage alert too — a leaked,
   unrestricted key burns your plan's credits.
2. **Server key** (edge function `SOLANA_RPC_URL` secret) — used by
   `supabase/functions/settle` and `candy-mint` for the `getTransaction` /
   `getAccountInfo` calls that verify settlement and mints against the chain.
   Never exposed to a browser, so domain restriction doesn't apply — just keep it
   out of any client-visible code (it lives only in the function secret store).

The URL form is `https://mainnet.helius-rpc.com/?api-key=<key>`. That's what
`@solana/kit`'s `createSolanaRpc()` expects (`lib/solana/config.ts:25`). No WSS URL
is needed; nothing in this codebase subscribes to RPC websockets.

**The free tier is a reasonable place to start an MVP**, with one caveat worth
knowing before your first drop: deploying a launchpad candy machine is by far the
RPC-heaviest client action — roughly N/50 `addConfigLines` transactions for a
supply of N (measured: 58 lines in the first batch, settling to ~51 as item
numbers get longer), plus polling reads between steps. Ordinary browsing, minting
and settlement are light by comparison. If deploys start failing, that's the
signal to upgrade the plan; it's a billing change, not a code change.

Two safety nets, so a tight rate limit degrades rather than breaks:

- **Pacing (client).** Every browser RPC request goes through one global rate limiter
  (`lib/solana/throttle.ts`), installed as the `fetch` on umi's Connection and as a
  wrapper on the `@solana/kit` transport. It spaces requests to
  `NEXT_PUBLIC_SOLANA_RPC_MAX_RPS` (default **8/s**), and on a 429 it reads
  `Retry-After` and backs *every* in-flight caller off together. Set this variable
  below your plan's limit and 429s should stop being something you retry. Deploys get
  slower rather than failing; raise it on a paid plan.
- **Retry.** `supabase/functions/_shared/rpc.ts` retries 5× with exponential backoff
  on HTTP 429, 5xx and non-JSON gateway responses; `lib/solana/retry.ts` does the same
  client-side on 429 only. One gap to know: umi-based reads (`fetchAsset`) bypass the
  retry wrapper — but not the pacer, which sits underneath at the transport.

Worth knowing if you're tuning this: the deploy's request volume is dominated by
*polling*, not by transactions. A 250-item deploy is only ~7–8 sends; the traffic is
confirmation polls and the account-visibility waits between steps. Both use exponential
backoff and poll the signature directly rather than watching for blockhash expiry, which
is why a large drop costs far fewer requests than its transaction count might suggest.

## 2. Generate a new mainnet settlement authority

The devnet settlement keypair (secret in local `supabase/functions/.env`) must
**not** be reused on mainnet.

```sh
# any keypair generator works; solana-keygen is simplest if installed
solana-keygen new --outfile /tmp/settlement-mainnet.json --no-bip39-passphrase
```

Convert to base58 secret (the format `getSettlementSigner` in
`supabase/functions/settle/index.ts` expects) and note the public key.

**Funding: none required.** Every settlement transaction sets the *buyer* as fee
payer and rent payer (`supabase/functions/settle/index.ts:169,184`); the
settlement authority only signs as the Core transfer delegate. Leave its balance
at zero — a zero balance also limits blast radius if the secret is ever
compromised, since it can't originate any transaction on its own.

Treat the secret like a hot wallet secret regardless: it goes **only** into the
Supabase Edge Function secret store (step 3), never into a `NEXT_PUBLIC_*` var,
never committed, never logged.

## 3. Supabase — new mainnet project

```sh
# create the project (or use the dashboard)
pnpm supabase projects create solarium-mainnet --org-id <your-org-id> --region <closest-region>

# link this checkout to it (don't unlink from devnet elsewhere — link is per-invocation
# via --project-ref if you need to keep working against devnet locally)
pnpm supabase link --project-ref <mainnet-project-ref>
```

### 3a. Auth / storage config

`supabase/config.toml` already has `[auth.web3.solana] enabled = true` and the
`nft-media`/`avatars` storage buckets are created by migration, not config — so
`config push` only needs to carry over Auth's redirect allow-list correctly.

Before pushing, edit `additional_redirect_urls` in `supabase/config.toml` to
include the production domain **in addition to** the existing localhost entries
(don't remove localhost — the same file still drives `supabase start` for local
dev):

```toml
additional_redirect_urls = [
  "http://localhost:3000",
  "http://localhost:3000/**",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3000/**",
  "https://<your-production-domain>",
  "https://<your-production-domain>/**",
]
```

This matters specifically because SIWS validates the message URI against this
allow-list. Get it wrong and wallet sign-in fails with **"Signed Solana message
is using URI which is not allowed on this server, message was signed for another
app"** — a 400 on `POST /auth/v1/token?grant_type=web3`, visible in the
project's Auth logs. Two details decide whether the list is right:

- **The signed URI is the whole page URL, not the origin.** `auth-js` sets
  `uri = window.location.href` (`GoTrueClient.js`, `signInWithWeb3`), so a user
  who connects their wallet from `/launchpad/apply` signs
  `https://<domain>/launchpad/apply`. Listing only the bare origin authorises
  sign-in from the site root and nowhere else.
- **`**`, not `*`.** A single star does not cross `/`, so
  `https://<domain>/*` covers `/portfolio` but rejects `/collections/<id>`.

Both hostnames need entries if the site answers on apex *and* `www` — the wallet
signs whichever one the browser is actually on. Same for the
`*.vercel.app` alias, if you sign in there to smoke-test a deploy.

Note that `site_url` is deliberately **not** changed to the production domain in
`config.toml`: it stays `http://localhost:3000` so that a later `config push`
from a dev machine cannot clobber production's value. Nothing depends on it here
(wallet-only auth sends no emails), and the allow-list above is what actually
authorises sign-in. Then:

```sh
pnpm supabase config push --project-ref <mainnet-project-ref>
```

### 3b. Schema + storage buckets

```sh
pnpm supabase db push --project-ref <mainnet-project-ref>
```

Applies all migrations — **14 files** as of the 2026-08-08 squashed baseline,
`20260808000100_extensions_and_helpers.sql` through
`20260808001400_collection_item_rarity.sql` — including the `nft-media`/`avatars`
bucket creation and the explicit API grants (`20260808001200_grants.sql` — remember
`auto_expose_new_tables` is unset, so any *future* migration adding a table needs
its own `grant` statements or PostgREST will silently 404/empty-result on it).

Two storage facts you can't infer from the dashboard:

- `20260808001300_storage.sql` creates both buckets **public**, with
  `on conflict (id) do nothing`. Re-running the migration will **not** repair a
  bucket that already exists with different settings — if you hand-created either
  bucket first, check its public flag by hand.
- Neither bucket sets `file_size_limit` or `allowed_mime_types`, so the
  project-wide dashboard limit is what actually applies. `config.toml`'s
  `[storage] file_size_limit = "50MiB"` governs the **local** stack only and is
  not pushed. Set the hosted limit deliberately: a drop uploads one image per
  item, up to 250 (`_shared/manifest.ts:28`), plus a cover and banner.

### 3c. Edge function + secrets

Deploy **all three**. None is optional:

```sh
# Settlement: builds and verifies the atomic sale transaction.
pnpm supabase functions deploy settle --project-ref <mainnet-project-ref>
# Records a buyer's mint by re-deriving it from the chain. Without it, mints land
# on chain but never get recorded — the buyer sees nothing in their portfolio.
pnpm supabase functions deploy candy-mint --project-ref <mainnet-project-ref>
# Rewrites placeholder metadata for delayed-reveal drops. Without it, any drop
# with reveal_at set can never be revealed — see 3d.
pnpm supabase functions deploy reveal --project-ref <mainnet-project-ref>

pnpm supabase secrets set \
  SETTLEMENT_AUTHORITY_SECRET=<mainnet-secret-from-step-2> \
  SOLANA_RPC_URL=<helius-mainnet-SERVER-key-url-from-step-1> \
  --project-ref <mainnet-project-ref>
```

Which function needs which secret:

| Function | `SOLANA_RPC_URL` | `SETTLEMENT_AUTHORITY_SECRET` |
|---|---|---|
| `settle` | yes (`index.ts:37`) | yes (`index.ts:43`) |
| `candy-mint` | yes (`index.ts:21`) | no |
| `reveal` | no | no |

Don't set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` —
hosted Edge Functions get those injected automatically; they're only in the local
`supabase/functions/.env` file because `functions serve` needs them explicitly.

All three are declared as `[functions.<name>]` tables in `config.toml`. That
declaration is what makes the **GitHub integration** deploy them on merge to the
production branch: it deploys new migrations plus the Edge Functions and Storage
buckets *declared in `config.toml`*, and silently skips functions that merely exist
on disk. (This was why nothing was deployed before 2026-08-08 — migrations flowed,
functions never did.) The `verify_jwt = true` in each table is the platform default
pinned explicitly rather than left implicit. Each one *also* re-checks the caller
itself — anon-key client, `auth.getUser()`, 401 if absent — so a caller always needs a real signed-in user's JWT, which
`supabase.functions.invoke` attaches automatically (`lib/settle/invoke.ts:9`).

### 3d. Delayed reveal is manual — there is no cron

Nothing schedules the `reveal` function. There's no `pg_cron` or `pg_net` anywhere
in `supabase/migrations/`, and no server-side caller: the only trigger is a button
in `components/launchpad/reveal-panel.tsx:45`, on the `/launchpad/[id]` page, which
enables itself once `collections.reveal_at` has passed.

So a drop with a delayed reveal stays hidden until *somebody presses it*. The
function is deliberately not creator-gated — after the deadline, what it writes is
fully determined by an already-public manifest, so any signed-in user can trigger
it and a creator who goes quiet can't strand the drop. That's a safety net, not a
plan. **If you ship a delayed-reveal drop, put the reveal on your own calendar.**

## 4. Frontend — Vercel

```sh
vercel link
```

Set these as **Production** environment variables in the Vercel project settings
(scope them to Production only — do not let them leak into Preview, which should
keep pointing at the devnet project):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | mainnet project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | mainnet project's anon key — see the name warning below |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Helius mainnet **client** key URL from step 1 |
| `NEXT_PUBLIC_SETTLEMENT_AUTHORITY` | mainnet settlement authority **public** key from step 2 |
| `SITE_URL` | `https://solarium-mkt.cc` — canonical origin, no trailing slash. **Production scope only** |
| `COINGECKO_API_KEY` | *Optional.* CoinGecko **Demo** (free) key — see below |

That's the complete set. Every variable but the last two is `NEXT_PUBLIC_*`.

**`SITE_URL` is what every canonical, `og:url`, `robots.txt` and `sitemap.xml`
entry is built against** (`lib/seo/site.ts`). Scope it to **Production only**: a
preview deployment that inherits the production value advertises production
canonicals from a preview URL, which is the standard way to get preview content
indexed under the real domain. Unset, the code falls back to Vercel's
per-environment `VERCEL_PROJECT_PRODUCTION_URL`, then to `http://localhost:3000`.
Like `COINGECKO_API_KEY` it is read on the server per request, so a change takes
effect without a rebuild.

**`COINGECKO_API_KEY` is the one server-only variable, and the only optional
one.** Get a free Demo key at <https://www.coingecko.com/en/developers/dashboard>
(no card required) and set it **without** a `NEXT_PUBLIC_` prefix, so it stays on
the server and out of the browser bundle. `lib/price/sol.ts` is called only from
server components (`components/site-header.tsx` and the nft / portfolio /
collection / launchpad pages), so nothing in the browser ever needs it.

Skipping it is fine — the app then calls the same endpoint keyless on CoinGecko's
shared public tier, where the rate limit is per IP and shared with everyone else
on your egress. Either way, a failed fetch logs `[sol-usd]` to the Vercel runtime
log and falls back to a hardcoded rate; the USD figure is display-only and never
enters a listing price or a settlement amount.

Note this key is **not** a Supabase function secret — no Edge Function fetches
prices, so do not `supabase secrets set` it.

If you later upgrade to a paid **Pro** plan, changing this value alone is not
enough: Pro keys must go to `pro-api.coingecko.com` with an `x-cg-pro-api-key`
header, both of which are hardcoded for the Demo tier in `lib/price/sol.ts`.

**Use the variable name `NEXT_PUBLIC_SUPABASE_ANON_KEY` exactly.** If your project
issues what the dashboard calls a *publishable* key, put that value under this
name anyway: `lib/supabase/client.ts:6`, `lib/supabase/server.ts:9` and `proxy.ts:9`
read `ANON_KEY` and nothing anywhere reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
Getting this wrong yields `undefined` inside `createBrowserClient` rather than a
clear error. (The `.env.prod` file in this checkout has exactly that mistake.)

Two more things about these vars:

- The `NEXT_PUBLIC_*` ones are inlined into the bundle at **build** time. Editing
  one in the Vercel dashboard does nothing until you redeploy. `COINGECKO_API_KEY`
  is the exception: it's read on the server per request, so a change there takes
  effect on save (allowing for the 60s `revalidate` cache).
- `proxy.ts` — Next 16's middleware, note the filename — runs on nearly every
  request and reads the two Supabase vars too, so they must be present for the
  server runtime, not just the client build.

Build/install: Vercel auto-detects Next.js; since this repo pins `pnpm` via
`packageManager` in `package.json`, Vercel will use pnpm automatically. Use Node
**≥ 20** (the repo is developed on 24). No custom build command needed (`pnpm build`).

Attach the production domain and confirm HTTPS is active before testing wallet
sign-in — SIWS redirect validation will fail against an http:// origin that isn't
in the allow-list from step 3a.

## 5. Post-deploy verification (use real but minimal SOL)

Run the full flow end-to-end against production before calling it done:

1. Connect wallet, SIWS sign-in completes without redirect errors.
2. Launch a drop at `/launchpad/apply` — this is the primary creator path now, and the
   step most likely to break first on a new environment. Use a **small supply that still
   spans more than one config-line batch** (say 80–100; the ceiling is 250): the batching
   is compute-bound, so a supply under ~58 never exercises the chunking at all. Then
   deploy its candy machine and confirm every `addConfigLines` transaction lands.
3. Mint from that drop with a **second** wallet and confirm the item appears — that
   exercises `candy-mint`, which is the only thing that records a buyer's mint.
4. List an item for a small price, confirm the transfer-delegate plugin add succeeds.
5. Buy it from a **second** wallet (seller can't buy their own listing).
6. Buy an item in a collection **you created**, listed by someone else — the royalty leg
   is skipped in that case, and it has its own build/verify path worth exercising once.
7. If you plan to use delayed reveal, exercise it once: set a `reveal_at` a few
   minutes out on a test drop, mint while it's hidden, then press Reveal after the
   deadline and confirm the `{n}.json` files get rewritten from the manifest and
   the already-minted rows backfill `image_url`, `traits` and rarity.
8. Check `pnpm supabase functions logs settle --project-ref <mainnet-project-ref>`
   for the `prepare`/`confirm` calls and confirm the listing flips to `sold`. Check
   `candy-mint` (and `reveal`, if you did step 7) logs the same way.
9. Watch the Helius dashboard for the first hour — a usage spike unrelated to
   your own testing is the signal that the client key leaked or the allowed-domain
   restriction isn't actually applied.

## 6. Ongoing operational notes

- **Secret rotation:** if the mainnet settlement authority secret ever leaks,
  every *active* listing has that key delegated on-chain as its transfer
  authority. Rotating means generating a new authority, updating the secret +
  `NEXT_PUBLIC_SETTLEMENT_AUTHORITY`, and getting every seller to re-list (cancel
  removes the old delegate; listing again adds the new one) — there's no bulk
  re-delegate path today. Worth knowing before it's urgent.
- **RPC cost/rate alerts:** set them on both Helius keys, not just the client one —
  the server key has no domain protection and a bug that loops RPC calls would show
  up there first.
- **Monitor Supabase project usage/billing** on the new mainnet project
  separately from the devnet one now that they're split. Storage is the one to
  watch: it holds every drop's art permanently (see 0b).
- **`collections.verified` is set by hand, by the service role.** There is no
  application or review queue — `launch_applications`, its trigger and
  `sync_creator_verified()` were dropped on 2026-08-08, and launches are self-serve.
  The column is deliberately **not** writable through PostgREST: the `authenticated`
  UPDATE grant is column-scoped and excludes it, alongside `royalty_bps`
  (`20260808001200_grants.sql:49-56`), so a creator cannot self-verify. To award the
  badge, run SQL as the service role from the dashboard:

  ```sql
  update public.collections set verified = true where id = '<collection-id>';
  ```

  Anyone expecting the old apply-and-get-reviewed loop will find no queue to review.
- **Launchpad drop deploys are the RPC-heaviest client action** — a supply of N needs
  roughly N/50 `addConfigLines` transactions (measured: 58 lines in the first batch,
  settling to ~51 as item numbers get longer) plus polling reads between steps. Budget
  for it on the client Helius key before a large drop; this is the first thing to hit a
  free-tier limit.
