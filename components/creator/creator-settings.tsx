"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Card, Input, Select, Switch } from "@/components/design";
import { createClient } from "@/lib/supabase/client";

const LABEL: React.CSSProperties = {
  display: "block",
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-4)",
};

export type RoyaltyCollection = { id: string; name: string; royaltyBps: number };

export function CreatorSettings({ collections, royaltiesEarnedSol }: { collections: RoyaltyCollection[]; royaltiesEarnedSol: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const initialRate = ((collections.find((c) => c.id === collectionId)?.royaltyBps ?? 0) / 100).toFixed(1);
  const [rate, setRate] = useState(initialRate);
  const [enforce, setEnforce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const pickCollection = (id: string) => {
    setCollectionId(id);
    setRate(((collections.find((c) => c.id === id)?.royaltyBps ?? 0) / 100).toFixed(1));
    setMsg(null);
  };

  const save = async () => {
    const pct = parseFloat(rate);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      setMsg({ tone: "err", text: "Enter a rate between 0 and 100." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("collections").update({ royalty_bps: Math.round(pct * 100) }).eq("id", collectionId);
    setBusy(false);
    if (error) setMsg({ tone: "err", text: error.message });
    else {
      setMsg({ tone: "ok", text: "Royalty saved." });
      router.refresh();
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
      <Card padding="var(--space-8)" header="Royalties earned">
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>
          {royaltiesEarnedSol}
          <span style={{ fontSize: "0.6em", marginLeft: 4, color: "var(--text-secondary)" }}>SOL</span>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 2 }}>Lifetime, across all collections</div>
        <p style={{ marginTop: "var(--space-7)", marginBottom: 0, fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
          Royalties are paid to your wallet instantly as each sale settles — there&apos;s no balance to claim.
        </p>
      </Card>

      <Card padding="var(--space-8)" header="Royalty">
        {collections.length > 1 && (
          <div style={{ marginBottom: "var(--space-6)" }}>
            <label style={LABEL}>Collection</label>
            <Select options={collections.map((c) => ({ value: c.id, label: c.name }))} value={collectionId} onChange={(e) => pickCollection(e.target.value)} />
          </div>
        )}
        <label style={LABEL}>Rate</label>
        <div style={{ display: "flex", gap: "var(--space-5)", alignItems: "center" }}>
          <Input numeric suffix="%" value={rate} onChange={(e) => setRate(e.target.value)} containerStyle={{ width: 140 }} />
          <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={save}>Save</Button>
        </div>
        <div style={{ marginTop: "var(--space-7)" }}>
          <Switch checked={enforce} onChange={() => setEnforce((v) => !v)} label="Enforce on Solarium listings" />
        </div>
        <p style={{ marginTop: "var(--space-6)", marginBottom: 0, fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
          Enforcement applies to sales settled on Solarium. Trades routed through other venues may bypass it.
        </p>
        {msg && <p style={{ marginTop: "var(--space-5)", marginBottom: 0, fontSize: "var(--text-xs)", color: msg.tone === "err" ? "var(--price-down)" : "var(--price-up)" }}>{msg.text}</p>}
      </Card>
    </div>
  );
}
