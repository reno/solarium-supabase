#!/usr/bin/env node
// Point the seeded world at real wallets, so you can sign in with Phantom and
// land on a persona that already has social, bids and (after `pnpm seed:onchain`)
// real devnet assets handed to it.
//
// `supabase/seed.sql` builds six personas around placeholder addresses nobody
// controls. This script rebinds a persona to an address you *do* control:
//
//   pnpm seed:e2e <address> [<address> ...]        # positional, in persona order
//   pnpm seed:e2e orbit=<address> vega=<address>   # explicit personas
//   pnpm seed:e2e --reset <address>                # db reset (reload seed) first
//   pnpm seed:e2e <address> --username reno        # keep your own handle
//   pnpm seed:e2e --list                           # show personas and exit
//
// The seed holds no collections — every collection in the database is a real one, minted by
// `pnpm seed:onchain` (which binds the two creator personas to the keypairs it mints with, so
// bare addresses here bind the collectors first).
//
// Why it takes more than an UPDATE on profiles.wallet_address: Supabase web3
// sign-in matches an existing user through `auth.identities`, keyed on
// provider_id = "web3:solana:<address>". Without that row GoTrue treats the
// wallet as new, creates a second user, and `handle_new_user` then trips the
// unique index on profiles.wallet_address — sign-in fails with a 500
// ("Database error saving new user"). GoTrue also scans auth.users' token
// columns into Go strings, so they must be '' rather than NULL.

import { execFileSync } from "node:child_process";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// The cast of supabase/seed.sql. Bare addresses bind in this order, skipping the two personas
// `pnpm seed:onchain` drives — those hold the keys to real devnet collections, and rebinding one
// would strand its assets (you can still name them explicitly if that's what you want).
const PERSONAS = [
  {
    key: "orbit",
    id: "10000000-0000-4000-8000-000000000004",
    role: "collector",
    owns: "likes, comments, an open bid; on the launchpad allowlist; receives on-chain hand-offs",
  },
  {
    key: "vega",
    id: "10000000-0000-4000-8000-000000000005",
    role: "collector",
    owns: "likes, comments, an open collection offer; on the launchpad allowlist",
  },
  {
    key: "ceres_eth",
    id: "10000000-0000-4000-8000-000000000006",
    role: "collector",
    owns: "likes, comments, an open bid; receives on-chain hand-offs",
  },
  {
    key: "nova",
    id: "10000000-0000-4000-8000-000000000003",
    role: "creator",
    owns: "a pending launch application (no collection yet — mint one to test the creator flows)",
  },
  {
    key: "solara",
    id: "10000000-0000-4000-8000-000000000001",
    role: "creator",
    owns: "a real devnet collection + listings — bound by `pnpm seed:onchain`",
    onchain: true,
  },
  {
    key: "lumen_labs",
    id: "10000000-0000-4000-8000-000000000002",
    role: "creator",
    owns: "a real devnet collection + listings — bound by `pnpm seed:onchain`",
    onchain: true,
  },
];

// --- base58 -----------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decode base58 to bytes, or null when the string isn't valid base58. */
function base58Decode(str) {
  const bytes = [0];
  for (const char of str) {
    const value = B58.indexOf(char);
    if (value === -1) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  for (const char of str) {
    if (char !== "1") break;
    leadingZeros++;
  }
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes.reverse()]);
}

/** A Solana address is a 32-byte ed25519 public key in base58. */
function assertAddress(address) {
  const decoded = base58Decode(address);
  if (!decoded || decoded.length !== 32) {
    fail(`"${address}" is not a valid Solana address (want 32 bytes of base58)`);
  }
}

// --- plumbing ---------------------------------------------------------------

function fail(message) {
  console.error(`\n  error: ${message}\n`);
  process.exit(1);
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** The local stack's Postgres container, when it's running. */
function findDbContainer() {
  try {
    const names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return names.split("\n").find((name) => /^supabase_db_/.test(name)) ?? null;
  } catch {
    return null;
  }
}

function hasLocalPsql() {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run SQL against the target database. Prefers a local psql; otherwise borrows
 * the one inside the supabase_db container (which can reach a hosted URL too,
 * but reaches the *local* database on its own port, not the host's).
 */
function makeRunner(dbUrl) {
  // psql writes the real diagnostic to stderr (inherited); a thrown Node stack
  // on top of it just buries the message.
  const guard = (fn) => (sql) => {
    try {
      return fn(sql);
    } catch {
      fail("psql rejected the statements above — nothing was committed.");
    }
  };

  if (hasLocalPsql()) {
    return guard((sql) =>
      execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"], {
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "inherit"],
      })
    );
  }

  const container = findDbContainer();
  if (!container) {
    fail(
      "no psql on PATH and no supabase_db container running.\n" +
        "  Start the stack with `pnpm supabase start`, or install psql."
    );
  }
  // Inside the container the database is on localhost:5432, not the host port.
  const target = dbUrl === LOCAL_DB_URL ? "postgresql://postgres:postgres@localhost:5432/postgres" : dbUrl;
  return guard((sql) =>
    execFileSync("docker", ["exec", "-i", container, "psql", target, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    })
  );
}

// --- arguments --------------------------------------------------------------

function parseArgs(argv) {
  const options = { reset: false, force: false, list: false, dbUrl: LOCAL_DB_URL, usernames: [] };
  const assignments = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") options.reset = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--list" || arg === "-l") options.list = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--db-url") options.dbUrl = argv[++i] ?? fail("--db-url needs a value");
    else if (arg === "--username") options.usernames.push(argv[++i] ?? fail("--username needs a value"));
    else if (arg.startsWith("--")) fail(`unknown flag ${arg}`);
    else assignments.push(arg);
  }
  return { options, assignments };
}

/**
 * Attach `--username` values to the personas they rename. Bare `--username foo`
 * is only unambiguous when a single wallet is being bound.
 */
function applyUsernames(mapping, usernameArgs) {
  for (const arg of usernameArgs) {
    let entry;
    let username;

    if (arg.includes("=")) {
      const [key, value] = arg.split("=");
      entry = mapping.find((m) => m.persona.key === key);
      if (!entry) fail(`--username ${arg}: no wallet was bound to persona "${key}"`);
      username = value;
    } else {
      if (mapping.length !== 1) {
        fail(`--username ${arg} is ambiguous with ${mapping.length} wallets — use --username <persona>=<name>`);
      }
      entry = mapping[0];
      username = arg;
    }

    // Mirrors the check constraint on profiles.username.
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      fail(`"${username}" is not a valid username (3-30 chars of a-z, 0-9, _)`);
    }
    if (mapping.some((m) => m.username === username)) fail(`username "${username}" was given twice`);
    if (entry.username) fail(`persona "${entry.persona.key}" was given two usernames`);
    entry.username = username;
  }
}

/** Turn `<address>` / `persona=<address>` arguments into persona→address pairs. */
function resolveMapping(assignments) {
  // Bare addresses never land on a seed:onchain persona by accident.
  const bindable = PERSONAS.filter((p) => !p.onchain);
  const mapping = [];
  let positional = 0;

  for (const assignment of assignments) {
    let persona;
    let address;

    if (assignment.includes("=")) {
      const [key, value] = assignment.split("=");
      persona = PERSONAS.find((p) => p.key === key);
      if (!persona) fail(`unknown persona "${key}". Run with --list to see them.`);
      address = value;
      if (persona.onchain && !process.env.SEED_ONCHAIN_BINDING) {
        console.warn(
          `\n  ⚠  "${persona.key}" is the on-chain seed's creator wallet. Binding it here hands its\n` +
            `     real devnet collection to ${address}, which holds no keys for those assets —\n` +
            `     re-run \`pnpm seed:onchain\` afterwards to mint a fresh one.`
        );
      }
    } else {
      persona = bindable[positional++];
      if (!persona) fail(`too many addresses — there are only ${bindable.length} bindable personas.`);
      address = assignment;
    }

    if (mapping.some((m) => m.persona.key === persona.key)) {
      fail(`persona "${persona.key}" was given twice`);
    }
    if (mapping.some((m) => m.address === address)) {
      fail(`address ${address} was given twice — each persona needs its own wallet`);
    }
    assertAddress(address);
    mapping.push({ persona, address });
  }
  return mapping;
}

// --- the remap --------------------------------------------------------------

/**
 * Rebind one persona to a real wallet: auth identity (so sign-in resolves to
 * this user), then every column that stores an address as text.
 */
function remapStatements({ persona, address, username }) {
  const sub = `web3:solana:${address}`;
  const id = quote(persona.id);
  const addr = quote(address);
  const subLiteral = quote(sub);
  const claims = quote(
    JSON.stringify({
      sub,
      custom_claims: { chain: "solana", address },
      email_verified: false,
      phone_verified: false,
    })
  );

  return `
-- ${persona.key} → ${address}
update auth.users set
  raw_app_meta_data = '{"provider":"web3","providers":["web3"]}'::jsonb,
  raw_user_meta_data = ${claims}::jsonb,
  -- email stays NULL: users_email_partial_key is unique across non-SSO users,
  -- so two wallet users sharing '' would collide.
  -- GoTrue scans these into non-nullable Go strings; NULL makes sign-in 500.
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  updated_at = now()
where id = ${id};

delete from auth.identities where user_id = ${id};
insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  ${subLiteral}, ${id},
  jsonb_build_object('sub', ${subLiteral}, 'custom_claims',
    jsonb_build_object('chain', 'solana', 'address', ${addr})),
  'web3', now(), now(), now());

-- Addresses stored as text elsewhere. Allowlist rows move with the persona.
update public.launchpad_allowlist set wallet_address = ${addr}
  where wallet_address = (select wallet_address from public.profiles where id = ${id});
update public.profiles set wallet_address = ${addr} where id = ${id};
update public.nfts set owner_wallet = ${addr} where owner_id = ${id};
${username ? `update public.profiles set username = ${quote(username)} where id = ${id};` : ""}`;
}

/** Usernames already held by somebody else — the rename would violate the unique index. */
function usernameConflictCheck(mapping) {
  const renames = mapping.filter((m) => m.username);
  if (renames.length === 0) return null;

  const clauses = renames
    .map((m) => `(p.username = ${quote(m.username)} and p.id <> ${quote(m.persona.id)})`)
    .join(" or ");
  return `select p.username || ' — held by ' || p.id::text from public.profiles p where ${clauses};`;
}

/**
 * A wallet that already signed in owns an auth user of its own. Leaving it in
 * place would collide with the persona on profiles.wallet_address, so it has to
 * go before the remap — but only when the operator asked for it.
 */
function conflictCheck(mapping, force) {
  const personaIds = mapping.map((m) => quote(m.persona.id)).join(", ");
  const addresses = mapping.map((m) => quote(m.address)).join(", ");
  const subs = mapping.map((m) => quote(`web3:solana:${m.address}`)).join(", ");

  const findConflicts = `
select distinct u.id::text || ' ' || coalesce(p.username, '(no username)')
from auth.users u
left join public.profiles p on p.id = u.id
left join auth.identities i on i.user_id = u.id
where u.id not in (${personaIds})
  and (p.wallet_address in (${addresses}) or i.provider_id in (${subs}));`;

  return force
    ? `delete from auth.users u where u.id not in (${personaIds})
         and (exists (select 1 from public.profiles p where p.id = u.id and p.wallet_address in (${addresses}))
           or exists (select 1 from auth.identities i where i.user_id = u.id and i.provider_id in (${subs})));`
    : findConflicts;
}

// --- main -------------------------------------------------------------------

const { options, assignments } = parseArgs(process.argv.slice(2));

if (options.help || (!options.list && assignments.length === 0)) {
  console.log(`
  Bind seeded personas to real wallets for end-to-end testing.

    pnpm seed:e2e <address> [<address> ...]         positional, in persona order
    pnpm seed:e2e orbit=<address> vega=<address>    explicit personas
    pnpm seed:e2e --reset <address>                 reload seed.sql first, then bind
    pnpm seed:e2e <address> --username reno         bind and rename the persona
    pnpm seed:e2e --list                            list personas

  Flags:
    --reset             run \`supabase db reset\` first (local only)
    --force             delete any existing auth user already holding an address
    --username <name>   rename the bound persona; repeatable as
                        --username <persona>=<name> when binding several wallets
    --db-url <url>      target another database (default: local stack)
`);
  process.exit(0);
}

if (options.list) {
  console.log("\n  Personas, in positional order:\n");
  let position = 0;
  for (const persona of PERSONAS) {
    const slot = persona.onchain ? "  -" : ` ${++position}.`;
    console.log(` ${slot} ${persona.key.padEnd(11)} ${persona.role.padEnd(10)} ${persona.owns}`);
  }
  console.log("\n  (- = bound by `pnpm seed:onchain`; name it explicitly to bind it yourself)\n");
  process.exit(0);
}

const mapping = resolveMapping(assignments);
applyUsernames(mapping, options.usernames);
const isLocal = options.dbUrl === LOCAL_DB_URL;

if (options.reset) {
  if (!isLocal) fail("--reset only applies to the local stack, not --db-url");
  console.log("\n  Resetting local database (re-running migrations + seed)…");
  execFileSync("pnpm", ["supabase", "db", "reset"], { stdio: "inherit" });
}

const run = makeRunner(options.dbUrl);

// Refuse to clobber a real user unless asked, then remap in one transaction.
const conflicts = run(conflictCheck(mapping, options.force)).trim();
if (!options.force && conflicts) {
  fail(
    `these wallets already have their own auth users:\n\n    ${conflicts.split("\n").join("\n    ")}\n\n` +
      "  Signing in would collide with the persona on profiles.wallet_address.\n" +
      "  Re-run with --force to delete them (cascades), or with --reset to start clean."
  );
}

const usernameCheck = usernameConflictCheck(mapping);
if (usernameCheck) {
  const taken = run(usernameCheck).trim();
  if (taken) {
    fail(
      `these usernames are taken:\n\n    ${taken.split("\n").join("\n    ")}\n\n` +
        "  profiles.username is unique — pick another, or --force/--reset to clear the holder."
    );
  }
}

const sql = [
  "begin;",
  ...mapping.map(remapStatements),
  "commit;",
].join("\n");
run(sql);

// Report what each wallet now owns, straight from the database.
const summary = run(`
select p.username || '\t' || p.wallet_address || '\t'
    || (select count(*) from public.nfts n where n.owner_id = p.id) || '\t'
    || (select count(*) from public.listings l where l.seller_id = p.id and l.status = 'active') || '\t'
    || (select count(*) from public.collections c where c.creator_id = p.id)
from public.profiles p
where p.id in (${mapping.map((m) => quote(m.persona.id)).join(", ")})
order by p.id;`);

console.log("\n  Bound seeded personas to your wallets:\n");
console.log(`  ${"persona".padEnd(12)}${"nfts".padEnd(7)}${"listed".padEnd(8)}collections`);
for (const line of summary.trim().split("\n")) {
  const [username, address, nfts, listed, collections] = line.split("\t");
  console.log(`  ${username.padEnd(12)}${nfts.padEnd(7)}${listed.padEnd(8)}${collections}`);
  console.log(`  ${" ".repeat(12)}${address}`);
}
console.log("\n  Connect that wallet in the app — sign-in resolves to the seeded user.\n");
