"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ArtTile, Badge, Button, Card, Input, Select, Switch } from "@/components/design";
import { submitApplication } from "@/lib/launchpad/apply";
import { solToLamports } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/client";

const STEPS = ["Project", "Artwork", "Supply", "Phases", "Review"];

const LABEL: React.CSSProperties = {
  display: "block",
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-4)",
};

function field(label: string, node: React.ReactNode) {
  return (
    <div style={{ marginBottom: "var(--space-6)" }}>
      <label style={LABEL}>{label}</label>
      {node}
    </div>
  );
}

export function ApplyWizard({ creatorId }: { creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [metadataSource, setMetadataSource] = useState("Arweave");
  const [supply, setSupply] = useState("");
  const [price, setPrice] = useState("");
  const [royalty, setRoyalty] = useState("5.0");
  const [walletLimit, setWalletLimit] = useState("");
  const [revealMode, setRevealMode] = useState("Delayed");
  const [allowlist, setAllowlist] = useState(true);
  const [startsAt, setStartsAt] = useState("");

  const priceNum = parseFloat(price) || 0;
  const supplyNum = parseInt(supply, 10) || 0;
  const grossSol = (priceNum * supplyNum).toFixed(2);
  const allowlistPrice = (priceNum * 0.8).toFixed(4);

  const dateInput: React.CSSProperties = {
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

  const canNext = step === 0 ? name.trim().length > 0 : true;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let mintPriceLamports: bigint | null = null;
      if (price.trim()) {
        try {
          mintPriceLamports = solToLamports(price);
        } catch {
          throw new Error("Enter a valid mint price in SOL.");
        }
      }
      const phases = [
        ...(allowlist
          ? [{ name: "Allowlist", priceLamports: mintPriceLamports ? ((mintPriceLamports * 8n) / 10n).toString() : "0", perWalletLimit: 2, startsAt: startsAt ? new Date(startsAt).toISOString() : null }]
          : []),
        { name: "Public", priceLamports: mintPriceLamports ? mintPriceLamports.toString() : "0", perWalletLimit: walletLimit.trim() ? Number(walletLimit) : null, startsAt: startsAt ? new Date(startsAt).toISOString() : null },
      ];
      await submitApplication(supabase, {
        creatorId,
        name: name.trim(),
        description: description.trim() || null,
        website: website.trim() || null,
        twitter: twitter.trim() || null,
        metadataSource,
        supply: supplyNum || null,
        mintPriceLamports,
        royaltyBps: Math.round((parseFloat(royalty) || 0) * 100),
        perWalletLimit: walletLimit.trim() ? Number(walletLimit) : null,
        revealMode,
        phases,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card padding="var(--space-9)" style={{ maxWidth: 560, textAlign: "center" }}>
        <Badge tone="accent" dot>Pending review</Badge>
        <h2 style={{ font: "var(--type-h3)", color: "var(--text-primary)", margin: "var(--space-6) 0 var(--space-4)" }}>Application submitted</h2>
        <p style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
          Review takes 2–3 business days. You&apos;ll get a wallet notification either way.
        </p>
        <div style={{ marginTop: "var(--space-8)" }}>
          <Button variant="secondary" onClick={() => router.push("/creator")}>Back to Creator</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="var(--space-9)" style={{ maxWidth: 620 }}>
      {/* progress bar */}
      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 3, borderRadius: 999, background: i <= step ? "var(--accent)" : "var(--surface-3)" }} />
            <div style={{ marginTop: "var(--space-3)", fontSize: "var(--text-2xs)", color: i === step ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: i === step ? "var(--weight-semibold)" : undefined }}>
              {i + 1}. {s}
            </div>
          </div>
        ))}
      </div>

      {step === 0 && (
        <div>
          {field("Collection name", <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Photon Society" />)}
          {field("Description", <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Two sentences on the drop" />)}
          {field("Website", <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />)}
          {field("Twitter", <Input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@handle" />)}
        </div>
      )}

      {step === 1 && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-6)", marginBottom: "var(--space-7)" }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>Preview (1:1)</label>
              <ArtTile label="1:1 art" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>Banner (6:1)</label>
              <ArtTile label="6:1 banner" ratio="6 / 1" />
            </div>
          </div>
          {field("Metadata source", <Select options={["Arweave", "IPFS", "JSON"]} value={metadataSource} onChange={(e) => setMetadataSource(e.target.value)} />)}
          <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>Artwork is not uploaded during the application — you&apos;ll add it after approval.</p>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
            {field("Supply", <Input numeric value={supply} onChange={(e) => setSupply(e.target.value)} placeholder="5000" />)}
            {field("Mint price", <Input numeric suffix="SOL" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.75" />)}
            {field("Royalty", <Input numeric suffix="%" value={royalty} onChange={(e) => setRoyalty(e.target.value)} />)}
            {field("Per-wallet limit", <Input numeric value={walletLimit} onChange={(e) => setWalletLimit(e.target.value)} placeholder="5" />)}
            {field("Reveal", <Select options={["Delayed", "Instant"]} value={revealMode} onChange={(e) => setRevealMode(e.target.value)} />)}
          </div>
          <div style={{ marginTop: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>
            Gross at full mint: <span style={{ color: "var(--text-primary)" }}>{grossSol} SOL</span>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ marginBottom: "var(--space-7)" }}>
            <Switch checked={allowlist} onChange={() => setAllowlist((v) => !v)} label="Add an allowlist phase" />
          </div>
          {allowlist && (
            <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "0 0 var(--space-7)" }}>
              Allowlist auto-prices at 80% of public: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{allowlistPrice} SOL</span>, 2 per wallet.
            </p>
          )}
          {field("Public phase start (UTC)", <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={dateInput} />)}
        </div>
      )}

      {step === 4 && (
        <div>
          <Badge tone="accent">Pending review</Badge>
          <div style={{ marginTop: "var(--space-7)" }}>
            {([["Collection", name || "—"], ["Supply", supply || "—"], ["Mint price", price ? `${price} SOL` : "—"], ["Royalty", `${royalty}%`], ["Reveal", revealMode], ["Phases", allowlist ? "Allowlist + Public" : "Public"], ["Metadata", metadataSource]] as const).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-4) 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>{k}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>{v}</span>
              </div>
            ))}
          </div>
          <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "var(--space-6) 0 0" }}>
            Submitting signs a message — no SOL is spent.
          </p>
        </div>
      )}

      {error && <p style={{ marginTop: "var(--space-6)", marginBottom: 0, fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-8)" }}>
        <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</Button>
        ) : (
          <Button variant="primary" icon="check" loading={busy} disabled={busy} onClick={submit}>Submit application</Button>
        )}
      </div>
    </Card>
  );
}
