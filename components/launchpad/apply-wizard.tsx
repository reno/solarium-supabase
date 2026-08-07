"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Card, Input, Select, Switch } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { createLaunch, type LaunchPhaseInput } from "@/lib/launchpad/launch";
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

const DATE_INPUT: React.CSSProperties = {
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

function field(label: string, node: React.ReactNode) {
  return (
    <div style={{ marginBottom: "var(--space-6)" }}>
      <label style={LABEL}>{label}</label>
      {node}
    </div>
  );
}

function ArtworkPicker({
  file,
  preview,
  onPick,
  ratio,
  hint,
}: {
  file: File | null;
  preview: string | null;
  onPick: (file: File) => void;
  ratio: string;
  hint: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        cursor: "pointer",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        aspectRatio: ratio,
        padding: "var(--space-6)",
        borderRadius: "var(--radius-card)",
        border: `1px dashed ${file ? "var(--accent)" : "var(--border-strong)"}`,
        background: "var(--surface-inset)",
        fontSize: "var(--text-xs)",
        color: "var(--text-tertiary)",
        overflow: "hidden",
        textAlign: "center",
      }}
    >
      {preview ? (
        <Image
          src={preview}
          alt="Preview"
          width={480}
          height={480}
          style={{ maxHeight: "100%", maxWidth: "100%", width: "auto", objectFit: "contain", borderRadius: "var(--radius-media)" }}
          unoptimized
        />
      ) : (
        <span>{hint}</span>
      )}
      <input
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) onPick(chosen);
        }}
      />
    </label>
  );
}

export function ApplyWizard({ creatorId }: { creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [supply, setSupply] = useState("");
  const [price, setPrice] = useState("");
  const [royalty, setRoyalty] = useState("5.0");
  const [walletLimit, setWalletLimit] = useState("");
  const [revealMode, setRevealMode] = useState("Instant");
  const [revealAt, setRevealAt] = useState("");
  const [allowlist, setAllowlist] = useState(true);
  const [allowlistStart, setAllowlistStart] = useState("");
  const [allowlistWallets, setAllowlistWallets] = useState("");
  const [publicStart, setPublicStart] = useState("");

  const walletList = allowlistWallets.split(/[\s,]+/).filter(Boolean);
  const invalidWallets = walletList.filter((w) => !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w));

  const priceNum = parseFloat(price) || 0;
  const supplyNum = parseInt(supply, 10) || 0;
  const grossSol = (priceNum * supplyNum).toFixed(2);
  const allowlistPrice = (priceNum * 0.8).toFixed(4);

  const canNext =
    step === 0
      ? name.trim().length > 0
      : step === 1
        ? cover !== null
        : step === 2
          ? supplyNum > 0 && (revealMode === "Instant" || revealAt !== "")
          : step === 3
            ? publicStart !== "" &&
              (!allowlist || (allowlistStart !== "" && walletList.length > 0 && invalidWallets.length === 0))
            : true;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!cover) throw new Error("Choose the drop artwork.");
      let mintPriceLamports: bigint;
      try {
        mintPriceLamports = price.trim() ? solToLamports(price) : 0n;
      } catch {
        throw new Error("Enter a valid mint price in SOL.");
      }
      const publicStartIso = new Date(publicStart).toISOString();
      const phases: LaunchPhaseInput[] = [];
      if (allowlist) {
        const allowlistStartIso = new Date(allowlistStart).toISOString();
        if (allowlistStartIso >= publicStartIso) {
          throw new Error("The allowlist phase has to start before the public phase.");
        }
        phases.push({
          name: "Allowlist",
          priceLamports: (mintPriceLamports * 8n) / 10n,
          startsAt: allowlistStartIso,
          endsAt: publicStartIso,
          perWalletLimit: 2,
          allowlistOnly: true,
        });
      }
      phases.push({
        name: "Public",
        priceLamports: mintPriceLamports,
        startsAt: publicStartIso,
        endsAt: null,
        perWalletLimit: walletLimit.trim() ? Number(walletLimit) : null,
        allowlistOnly: false,
      });

      const collectionId = await createLaunch(supabase, {
        creatorId,
        name: name.trim(),
        description: description.trim() || null,
        cover,
        banner,
        royaltyBps: Math.round((parseFloat(royalty) || 0) * 100),
        revealAt: revealMode === "Delayed" && revealAt ? new Date(revealAt).toISOString() : null,
        phases,
        allowlistWallets: allowlist ? walletList : [],
      });

      showToast({ type: "success", title: "Drop created", message: name.trim() });
      router.push(`/launchpad/${collectionId}?supply=${supplyNum}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the drop.");
      setBusy(false);
    }
  };

  return (
    <Card padding="var(--space-9)" style={{ maxWidth: 620 }}>
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
          {field("Collection name", <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Photon Society" maxLength={100} />)}
          {field("Description", <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Two sentences on the drop" maxLength={2000} />)}
        </div>
      )}

      {step === 1 && (
        <div>
          <div style={{ display: "flex", gap: "var(--space-6)", marginBottom: "var(--space-6)" }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>Preview (1:1)</label>
              <ArtworkPicker
                file={cover}
                preview={coverPreview}
                ratio="1 / 1"
                hint="Click to choose the drop artwork"
                onPick={(f) => {
                  setCover(f);
                  setCoverPreview(URL.createObjectURL(f));
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>Banner (6:1, optional)</label>
              <ArtworkPicker
                file={banner}
                preview={bannerPreview}
                ratio="6 / 1"
                hint="Click to choose a banner"
                onPick={(f) => {
                  setBanner(f);
                  setBannerPreview(URL.createObjectURL(f));
                }}
              />
            </div>
          </div>
          <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: 0 }}>
            This is the drop&apos;s cover art. Each item&apos;s own artwork comes from the metadata the candy
            machine mints against.
          </p>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
            {field("Supply", <Input numeric value={supply} onChange={(e) => setSupply(e.target.value)} placeholder="5000" />)}
            {field("Mint price", <Input numeric suffix="SOL" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.75" />)}
            {field("Royalty", <Input numeric suffix="%" value={royalty} onChange={(e) => setRoyalty(e.target.value)} />)}
            {field("Per-wallet limit", <Input numeric value={walletLimit} onChange={(e) => setWalletLimit(e.target.value)} placeholder="5" />)}
            {field("Reveal", <Select options={["Instant", "Delayed"]} value={revealMode} onChange={(e) => setRevealMode(e.target.value)} />)}
            {revealMode === "Delayed" &&
              field("Reveal at", <input type="datetime-local" value={revealAt} onChange={(e) => setRevealAt(e.target.value)} style={DATE_INPUT} />)}
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
            <>
              <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "0 0 var(--space-6)" }}>
                Allowlist auto-prices at 80% of public: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{allowlistPrice} SOL</span>, 2 per wallet.
                It closes when the public phase opens.
              </p>
              {field("Allowlist start", <input type="datetime-local" value={allowlistStart} onChange={(e) => setAllowlistStart(e.target.value)} style={DATE_INPUT} />)}
              {field(
                `Allowlist wallets${walletList.length > 0 ? ` (${walletList.length})` : ""}`,
                <textarea
                  value={allowlistWallets}
                  onChange={(e) => setAllowlistWallets(e.target.value)}
                  rows={4}
                  placeholder={"One wallet address per line"}
                  style={{ ...DATE_INPUT, height: "auto", padding: "var(--space-5)", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}
                />
              )}
              {invalidWallets.length > 0 && (
                <p style={{ font: "var(--type-body-sm)", color: "var(--price-down)", margin: "calc(var(--space-6) * -1) 0 var(--space-6)" }}>
                  Not a valid wallet address: {invalidWallets.slice(0, 3).join(", ")}
                  {invalidWallets.length > 3 ? ` +${invalidWallets.length - 3} more` : ""}
                </p>
              )}
            </>
          )}
          {field("Public phase start", <input type="datetime-local" value={publicStart} onChange={(e) => setPublicStart(e.target.value)} style={DATE_INPUT} />)}
        </div>
      )}

      {step === 4 && (
        <div>
          <div>
            {(
              [
                ["Collection", name || "—"],
                ["Supply", supply || "—"],
                ["Mint price", price ? `${price} SOL` : "Free"],
                ["Royalty", `${royalty}%`],
                ["Reveal", revealMode],
                ["Phases", allowlist ? "Allowlist + Public" : "Public"],
                ...(allowlist ? ([["Allowlisted wallets", String(walletList.length)]] as const) : []),
              ] as const
            ).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-4) 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>{k}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>{v}</span>
              </div>
            ))}
          </div>
          <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "var(--space-6) 0 0" }}>
            Creating the drop costs nothing and mints nothing. Next you&apos;ll deploy its candy machine,
            which is the step that pays rent and puts these phases on chain.
          </p>
        </div>
      )}

      {error && <p style={{ marginTop: "var(--space-6)", marginBottom: 0, fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-8)" }}>
        <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</Button>
        ) : (
          <Button variant="primary" icon="rocket" loading={busy} disabled={busy} onClick={submit}>Create drop</Button>
        )}
      </div>
    </Card>
  );
}
