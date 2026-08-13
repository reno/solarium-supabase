"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Card, Input, Select, Switch } from "@/components/design";
import { addAllowlist, createPhase } from "@/lib/launchpad/manage";
import { repriceListings } from "@/lib/listings/listings";
import { solToLamports } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/client";

export type SetupCollection = { id: string; name: string };

const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-3)",
};

export function LaunchpadSetup({
  collections,
  userId,
  onChainDrop = false,
}: {
  collections: SetupCollection[];
  userId: string;
  onChainDrop?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [limit, setLimit] = useState("");
  const [allowlistOnly, setAllowlistOnly] = useState(false);
  const [repriceListed, setRepriceListed] = useState(true);
  const [wallets, setWallets] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  if (collections.length === 0) return null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await fn();
      setMsg({ tone: "ok", text: typeof result === "string" ? result : label });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const addPhase = () =>
    run("Phase added.", async () => {
      if (!name.trim()) throw new Error("Give the phase a name.");
      let priceLamports: bigint;
      try {
        priceLamports = solToLamports(price || "0");
      } catch {
        throw new Error("Enter a valid SOL price.");
      }
      await createPhase(supabase, {
        collectionId,
        name: name.trim(),
        priceLamports,
        startsAt: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        perWalletLimit: limit.trim() ? Number(limit) : null,
        allowlistOnly,
        position: 0,
      });

      let repriced = 0;
      if (repriceListed && !onChainDrop && priceLamports > 0n) {
        const { data: mine } = await supabase
          .from("nfts")
          .select("id")
          .eq("collection_id", collectionId)
          .eq("owner_id", userId);
        repriced = await repriceListings(supabase, {
          nftIds: (mine ?? []).map((n: { id: string }) => n.id),
          sellerId: userId,
          priceLamports,
        });
      }

      setName("");
      setPrice("");
      setStartsAt("");
      setEndsAt("");
      setLimit("");
      setAllowlistOnly(false);
      return repriced > 0
        ? `Phase added · ${repriced} listed item${repriced === 1 ? "" : "s"} repriced to ${price} SOL.`
        : "Phase added.";
    });

  const submitAllowlist = () =>
    run("Allowlist updated.", () => addAllowlist(supabase, collectionId, wallets.split(/[\s,]+/)).then(() => setWallets("")));

  const dateInputStyle: React.CSSProperties = {
    height: "var(--control-h-md)",
    padding: "0 var(--space-5)",
    background: "var(--surface-inset)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-control)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-md)",
    width: "100%",
  };

  return (
    <Card padding="var(--space-8)" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: "var(--space-7)" }}>
        <label style={FIELD_LABEL}>Collection</label>
        <Select
          options={collections.map((c) => ({ value: c.id, label: c.name }))}
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
        />
      </div>

      <div className="sol-cols-1-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
        <div>
          <label style={FIELD_LABEL}>Phase name</label>
          <Input placeholder="Public" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label style={FIELD_LABEL}>Price</label>
          <Input numeric suffix="SOL" placeholder="0.75" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div>
          <label style={FIELD_LABEL}>Starts</label>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={dateInputStyle} />
        </div>
        <div>
          <label style={FIELD_LABEL}>Ends (optional)</label>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={dateInputStyle} />
        </div>
        <div>
          <label style={FIELD_LABEL}>Per-wallet limit (optional)</label>
          <Input numeric placeholder="5" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "var(--space-3)" }}>
          <Switch checked={allowlistOnly} onChange={() => setAllowlistOnly((v) => !v)} label="Allowlist only" />
        </div>
      </div>
      <div style={{ marginTop: "var(--space-7)", display: "flex", alignItems: "center", gap: "var(--space-7)", flexWrap: "wrap" }}>
        <Button variant="primary" icon="plus" loading={busy} disabled={busy} onClick={addPhase}>Add phase</Button>
        {!onChainDrop && (
          <Switch
            checked={repriceListed}
            onChange={() => setRepriceListed((v) => !v)}
            label="Reprice my listed items to this price"
          />
        )}
      </div>
      <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
        {onChainDrop
          ? "This phase is only a draft until you sync it to the candy machine — the guards keep enforcing the phases you last deployed."
          : "Buyers pay each item's listing price, not the phase price — leave this on to keep them in step. No wallet signature needed; the price is off-chain."}
      </p>

      <div style={{ marginTop: "var(--space-9)", paddingTop: "var(--space-7)", borderTop: "1px solid var(--border-subtle)" }}>
        <label style={FIELD_LABEL}>Allowlist wallets (one per line or comma-separated)</label>
        <textarea
          value={wallets}
          onChange={(e) => setWallets(e.target.value)}
          rows={3}
          placeholder="7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
          style={{
            width: "100%",
            padding: "var(--space-5)",
            background: "var(--surface-inset)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-control)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            resize: "vertical",
          }}
        />
        <div style={{ marginTop: "var(--space-5)" }}>
          <Button variant="secondary" icon="user-plus" loading={busy} disabled={busy} onClick={submitAllowlist}>Add to allowlist</Button>
        </div>
      </div>

      {msg && (
        <p style={{ marginTop: "var(--space-6)", marginBottom: 0, fontSize: "var(--text-xs)", color: msg.tone === "err" ? "var(--price-down)" : "var(--price-up)" }}>{msg.text}</p>
      )}
    </Card>
  );
}
