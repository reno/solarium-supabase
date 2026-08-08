"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

import { Button, Card, Input, Select, Switch, Tabs } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { createLaunch, type LaunchPhaseInput } from "@/lib/launchpad/launch";
import {
  buildManifest,
  generateTraits,
  orderItemFiles,
  parseTraitsFile,
  planTraits,
  sampleTraitsFile,
  traitLayersOf,
  traitPlanIssue,
  MAX_DROP_SUPPLY,
  type ManifestTrait,
} from "@/lib/launchpad/manifest";
import { solToLamports } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/client";

const STEPS = ["Project", "Items", "Mint", "Phases", "Review"];

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

const COLUMN_LABEL: React.CSSProperties = { ...LABEL, marginBottom: 0 };

// One row of the generator: percent stays a string so a half-typed "12." doesn't get rewritten
// under the creator's cursor.
type WeightRow = { trait: string; value: string; percent: string };
const EMPTY_ROW: WeightRow = { trait: "", value: "", percent: "" };

function downloadSample(format: "csv" | "json", supply: number) {
  const url = URL.createObjectURL(
    new Blob([sampleTraitsFile(format, supply)], { type: format === "csv" ? "text/csv" : "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `traits-sample.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

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

function FileDropBox({
  hint,
  accept,
  multiple,
  active,
  onPick,
}: {
  hint: string;
  accept: string;
  multiple?: boolean;
  active: boolean;
  onPick: (files: File[]) => void;
}) {
  return (
    <label
      style={{
        display: "block",
        cursor: "pointer",
        padding: "var(--space-7) var(--space-6)",
        borderRadius: "var(--radius-card)",
        border: `1px dashed ${active ? "var(--accent)" : "var(--border-strong)"}`,
        background: "var(--surface-inset)",
        fontSize: "var(--text-sm)",
        color: active ? "var(--text-secondary)" : "var(--text-tertiary)",
        textAlign: "center",
      }}
    >
      {hint}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          if (chosen.length > 0) onPick(chosen);
          // Let the same selection be picked again after a validation error.
          event.target.value = "";
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
  const [progress, setProgress] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [items, setItems] = useState<File[]>([]);
  const [itemPreviews, setItemPreviews] = useState<string[]>([]);
  const [traitMode, setTraitMode] = useState<"upload" | "generate">("upload");
  const [uploadedTraits, setUploadedTraits] = useState<Map<number, ManifestTrait[]> | null>(null);
  const [traitsName, setTraitsName] = useState<string | null>(null);
  const [traitsError, setTraitsError] = useState<string | null>(null);
  const [weights, setWeights] = useState<WeightRow[]>([EMPTY_ROW]);
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
  // Supply is not typed in: it is however many item images the creator uploaded, which is the
  // only number that can match the config lines the machine gets loaded with.
  const supplyNum = items.length;
  const grossSol = (priceNum * supplyNum).toFixed(2);
  const allowlistPrice = (priceNum * 0.8).toFixed(4);

  // Preview only the first few, so a 250-item drop doesn't hold 250 object URLs open.
  const pickItems = (picked: File[]) => {
    itemPreviews.forEach(URL.revokeObjectURL);
    const ordered = orderItemFiles(picked);
    setItems(ordered);
    setItemPreviews(ordered.slice(0, 10).map((file) => URL.createObjectURL(file)));
  };

  const setWeight = (position: number, patch: Partial<WeightRow>) =>
    setWeights((rows) => rows.map((row, i) => (i === position ? { ...row, ...patch } : row)));

  // A row nobody has typed in yet is the next row, not an error.
  const weightRows = useMemo(
    () =>
      weights
        .filter(({ trait, value, percent }) => trait.trim() || value.trim() || percent.trim())
        .map(({ trait, value, percent }) => ({ trait, value, percent: parseFloat(percent) })),
    [weights]
  );

  const planIssue = useMemo(() => traitPlanIssue(weightRows), [weightRows]);
  const plan = useMemo(() => (planIssue ? [] : planTraits(weightRows, supplyNum)), [weightRows, planIssue, supplyNum]);
  const generated = useMemo(
    () => (planIssue ? null : generateTraits(weightRows, supplyNum)),
    [weightRows, planIssue, supplyNum]
  );

  const planCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const layer of plan) {
      for (const { value, count } of layer.values) {
        counts.set(`${layer.trait.toLowerCase()} ${value.toLowerCase()}`, count);
      }
    }
    return counts;
  }, [plan]);
  const countFor = (row: WeightRow) =>
    planCounts.get(`${row.trait.trim().toLowerCase()} ${row.value.trim().toLowerCase()}`);

  // Both modes hand back the same shape parseTraitsFile does, so everything downstream — the
  // manifest, the rarity ranking, the upload — can't tell a generated drop from an uploaded one.
  const traits = traitMode === "generate" ? generated : uploadedTraits;
  const traitIssue = traitMode === "generate" ? planIssue : traitsError;

  // The same validator that runs before upload, so a mismatched traits file is caught here
  // rather than after 250 uploads.
  const itemIssue = useMemo(() => {
    if (items.length === 0) return null;
    try {
      buildManifest({
        images: items.map((file, position) => ({ index: position + 1, url: "pending", type: file.type })),
        traits,
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "The artwork and the traits file don't line up.";
    }
  }, [items, traits]);

  const layers = useMemo(() => (traits ? traitLayersOf(traits) : []), [traits]);

  const pickTraits = async (file: File) => {
    try {
      const parsed = parseTraitsFile(await file.text(), file.name);
      setUploadedTraits(parsed);
      setTraitsName(file.name);
      setTraitsError(null);
    } catch (e) {
      setUploadedTraits(null);
      setTraitsName(null);
      setTraitsError(e instanceof Error ? e.message : "Could not read that traits file.");
    }
  };

  const canNext =
    step === 0
      ? name.trim().length > 0 && cover !== null
      : step === 1
        ? supplyNum > 0 && itemIssue === null && traitIssue === null
        : step === 2
          ? revealMode === "Instant" || revealAt !== ""
          : step === 3
            ? publicStart !== "" &&
              (!allowlist || (allowlistStart !== "" && walletList.length > 0 && invalidWallets.length === 0))
            : true;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!cover) throw new Error("Choose the drop artwork.");
      if (items.length === 0) throw new Error("Add at least one item image.");
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

      const collectionId = await createLaunch(
        supabase,
        {
          creatorId,
          name: name.trim(),
          description: description.trim() || null,
          cover,
          banner,
          items,
          traits,
          royaltyBps: Math.round((parseFloat(royalty) || 0) * 100),
          revealAt: revealMode === "Delayed" && revealAt ? new Date(revealAt).toISOString() : null,
          phases,
          allowlistWallets: allowlist ? walletList : [],
        },
        (stage, done, total) => {
          setProgress(
            stage === "items"
              ? `Uploading items ${done} of ${total}`
              : stage === "artwork"
                ? "Uploading artwork"
                : stage === "manifest"
                  ? "Writing the item manifest"
                  : "Creating the drop"
          );
        }
      );

      showToast({ type: "success", title: "Drop created", message: name.trim() });
      router.push(`/launchpad/${collectionId}?supply=${supplyNum}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the drop.");
      setProgress(null);
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
            This is the drop&apos;s cover art — what the launchpad and the collection page show. The items
            themselves get their own artwork in the next step.
          </p>
        </div>
      )}

      {step === 1 && (
        <div>
          <div style={{ marginBottom: "var(--space-7)" }}>
            <label style={LABEL}>Item artwork{items.length > 0 ? ` · ${items.length}` : ""}</label>
            <FileDropBox
              accept="image/*"
              multiple
              active={items.length > 0}
              hint={
                items.length > 0
                  ? `${items.length} image${items.length === 1 ? "" : "s"} chosen — click to replace`
                  : "Click to choose one image per item"
              }
              onPick={pickItems}
            />
            {itemPreviews.length > 0 && (
              <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
                {itemPreviews.map((src, position) => (
                  <Image
                    key={src}
                    src={src}
                    alt={`Item ${position + 1}`}
                    width={44}
                    height={44}
                    unoptimized
                    style={{ width: 44, height: 44, objectFit: "cover", borderRadius: "var(--radius-media)" }}
                  />
                ))}
                {items.length > itemPreviews.length && (
                  <span style={{ alignSelf: "center", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
                    +{items.length - itemPreviews.length} more
                  </span>
                )}
              </div>
            )}
            <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "var(--space-4) 0 0" }}>
              Every item is its own 1/1. Files are ordered by name — 1.png, 2.png, 10.png — and that is the item
              order. Supply is however many you upload, up to {MAX_DROP_SUPPLY}.
            </p>
          </div>

          <div style={{ marginBottom: "var(--space-7)" }}>
            <label style={LABEL}>Traits{layers.length > 0 ? ` · ${layers.length} layers` : " (optional)"}</label>
            <Tabs
              size="sm"
              tabs={[
                { value: "upload", label: "Upload a file" },
                { value: "generate", label: "Generate" },
              ]}
              value={traitMode}
              onChange={(mode) => setTraitMode(mode as "upload" | "generate")}
              style={{ marginBottom: "var(--space-5)" }}
            />

            {traitMode === "upload" ? (
              <>
                <FileDropBox
                  accept=".csv,.tsv,.json"
                  active={uploadedTraits != null}
                  hint={traitsName ? `${traitsName} — click to replace` : "Click to choose a CSV or JSON traits file"}
                  onPick={(picked) => void pickTraits(picked[0])}
                />
                <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
                  <Button size="sm" variant="ghost" icon="download" onClick={() => downloadSample("csv", supplyNum)}>
                    Sample CSV
                  </Button>
                  <Button size="sm" variant="ghost" icon="download" onClick={() => downloadSample("json", supplyNum)}>
                    Sample JSON
                  </Button>
                </div>
                <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "var(--space-4) 0 0" }}>
                  A CSV whose header names the layers, or a JSON array — one row per item, in the same order as the
                  artwork. A rare trait is rare because few rows carry it. Blank cells are written as &quot;None&quot;
                  so every item is ranked on the same footing. The samples come numbered for the
                  {supplyNum > 0 ? ` ${supplyNum} item${supplyNum === 1 ? "" : "s"} you uploaded` : " items you upload"},
                  so you can fill one in and hand it straight back. Skip this and items still mint, just without rarity.
                </p>
              </>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 88px 44px",
                    gap: "var(--space-3)",
                    alignItems: "center",
                  }}
                >
                  <span style={COLUMN_LABEL}>Trait</span>
                  <span style={COLUMN_LABEL}>Value</span>
                  <span style={COLUMN_LABEL}>Rarity</span>
                  <span style={{ ...COLUMN_LABEL, textAlign: "right" }}>Items</span>
                  {weights.map((row, position) => (
                    <Fragment key={position}>
                      <Input
                        size="sm"
                        placeholder="Background"
                        value={row.trait}
                        onChange={(e) => setWeight(position, { trait: e.target.value })}
                      />
                      <Input
                        size="sm"
                        placeholder="Deep Space"
                        value={row.value}
                        onChange={(e) => setWeight(position, { value: e.target.value })}
                      />
                      <Input
                        size="sm"
                        numeric
                        suffix="%"
                        placeholder="30"
                        value={row.percent}
                        onChange={(e) => setWeight(position, { percent: e.target.value })}
                      />
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--text-xs)",
                          color: "var(--text-tertiary)",
                          textAlign: "right",
                        }}
                      >
                        {supplyNum > 0 ? (countFor(row) ?? "—") : "—"}
                      </span>
                    </Fragment>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-5)" }}>
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => setWeights((rows) => [...rows, EMPTY_ROW])}>
                    Add trait
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="minus"
                    disabled={weights.length === 0}
                    onClick={() => setWeights((rows) => rows.slice(0, -1))}
                  >
                    Remove last
                  </Button>
                </div>

                {plan.length > 0 && supplyNum > 0 && (
                  <div
                    style={{
                      marginTop: "var(--space-5)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-2xs)",
                      color: "var(--text-tertiary)",
                      lineHeight: 1.8,
                    }}
                  >
                    {plan.map((layer) => (
                      <div key={layer.trait}>
                        {layer.trait}:{" "}
                        {[
                          ...layer.values.map(({ value, count }) => `${value} ${count}`),
                          ...(layer.absent > 0 ? [`None ${layer.absent}`] : []),
                        ].join(" · ")}
                      </div>
                    ))}
                  </div>
                )}

                <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "var(--space-4) 0 0" }}>
                  A rarity is a quota over the whole drop, not a per-mint chance: 5% of 200 items is exactly 10 of
                  them, settled here rather than rolled at mint. Whatever a trait&apos;s values leave unallocated
                  becomes &quot;None&quot;, which ranks as a value of its own — so a halo only 5% of items carry is
                  itself the rare thing.
                </p>
              </>
            )}
          </div>

          {(traitIssue || itemIssue) && (
            <p style={{ font: "var(--type-body-sm)", color: "var(--price-down)", margin: "0 0 var(--space-6)" }}>
              {traitIssue ?? itemIssue}
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
            {field("Mint price", <Input numeric suffix="SOL" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.75" />)}
            {field("Royalty", <Input numeric suffix="%" value={royalty} onChange={(e) => setRoyalty(e.target.value)} />)}
            {field("Per-wallet limit", <Input numeric value={walletLimit} onChange={(e) => setWalletLimit(e.target.value)} placeholder="5" />)}
            {field("Reveal", <Select options={["Instant", "Delayed"]} value={revealMode} onChange={(e) => setRevealMode(e.target.value)} />)}
            {revealMode === "Delayed" &&
              field("Reveal at", <input type="datetime-local" value={revealAt} onChange={(e) => setRevealAt(e.target.value)} style={DATE_INPUT} />)}
          </div>
          <div style={{ marginTop: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>
            Gross at full mint: <span style={{ color: "var(--text-primary)" }}>{grossSol} SOL</span>
            <span style={{ color: "var(--text-tertiary)" }}> · {supplyNum} item{supplyNum === 1 ? "" : "s"}</span>
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
                ["Supply", supplyNum ? String(supplyNum) : "—"],
                ["Traits", layers.length > 0 ? `${layers.length} layers` : "None"],
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
            Creating the drop uploads your items and costs nothing on chain — nothing is minted. Next you&apos;ll
            deploy its candy machine, which is the step that pays rent and puts these phases on chain. Buyers
            then mint in random order, so which artwork anyone gets is decided by the program.
          </p>
        </div>
      )}

      {error && <p style={{ marginTop: "var(--space-6)", marginBottom: 0, fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-8)" }}>
        <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
          {busy && progress && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
              {progress}
            </span>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</Button>
          ) : (
            <Button variant="primary" icon="rocket" loading={busy} disabled={busy} onClick={submit}>Create drop</Button>
          )}
        </div>
      </div>
    </Card>
  );
}
