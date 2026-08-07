"use client";

import { useState } from "react";

import { Button, Dialog, Icon } from "@/components/design";

export type TxLine = { label: string; value: string; strong?: boolean; muted?: boolean };
export type TxStage = { key: string; label: string };

export type TxFlowConfig = {
  title: string;
  approveLabel: string;
  lines: TxLine[];
  total: TxLine;
  fiatUsd?: number | null;
  balanceSol?: number | null;
  needSol?: number | null;
  stages: TxStage[];
  perform: (onStage: (key: string) => void) => Promise<{ signature?: string; summary?: string } | void>;
  successTitle: string;
  successDetail?: string;
  explorerUrl?: (signature: string) => string;
  errorHint?: string;
};

const LABEL_2XS: React.CSSProperties = {
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
};

export function TxFlow({
  open,
  onClose,
  onDone,
  config,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: (result: { signature?: string; summary?: string }) => void;
  config: TxFlowConfig;
}) {
  const [phase, setPhase] = useState<"review" | "confirming" | "success" | "error">("review");
  const [stage, setStage] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | undefined>(undefined);
  const [summary, setSummary] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const shortfall =
    config.balanceSol != null && config.needSol != null && config.balanceSol < config.needSol
      ? config.needSol - config.balanceSol
      : null;

  const run = async () => {
    setPhase("confirming");
    setStage(config.stages[0]?.key ?? null);
    setError(null);
    try {
      const result = (await config.perform(setStage)) ?? {};
      setSignature(result.signature);
      setSummary(result.summary);
      setStage(null);
      setPhase("success");
      onDone?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  };

  const dismissible = phase !== "confirming";

  const footer =
    phase === "review" ? (
      <>
        <Button variant="ghost" block onClick={onClose}>Cancel</Button>
        <Button variant="primary" block disabled={shortfall != null} onClick={run}>{config.approveLabel}</Button>
      </>
    ) : phase === "success" ? (
      <Button variant="primary" block onClick={onClose}>Done</Button>
    ) : phase === "error" ? (
      <>
        <Button variant="ghost" block onClick={onClose}>Close</Button>
        <Button variant="primary" block onClick={run}>Retry</Button>
      </>
    ) : undefined;

  return (
    <Dialog open={open} onClose={dismissible ? onClose : undefined} title={config.title} footer={footer}>
      {phase === "review" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {config.lines.map((l) => (
              <Row key={l.label} line={l} />
            ))}
          </div>
          <div style={{ marginTop: "var(--space-5)", paddingTop: "var(--space-5)", borderTop: "1px solid var(--border-subtle)" }}>
            <Row line={{ ...config.total, strong: true }} />
            {config.fiatUsd != null && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>≈ ${Math.round(config.fiatUsd).toLocaleString("en-US")}</span>
              </div>
            )}
          </div>
          {config.balanceSol != null && (
            <p style={{ margin: "var(--space-6) 0 0", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: shortfall != null ? "var(--price-down)" : "var(--text-tertiary)" }}>
              {shortfall != null
                ? `Insufficient balance — short ${shortfall.toFixed(3)} SOL (have ${config.balanceSol.toFixed(3)}).`
                : `Balance: ${config.balanceSol.toFixed(3)} SOL`}
            </p>
          )}
        </>
      )}

      {phase === "confirming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div style={LABEL_2XS}>Confirming</div>
          {config.stages.map((s, i) => {
            const curIdx = config.stages.findIndex((x) => x.key === stage);
            const done = i < curIdx;
            const current = i === curIdx;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    flex: "0 0 auto",
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: done ? "var(--accent)" : current ? "var(--accent-quiet)" : "var(--surface-3)",
                    border: current ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                    boxShadow: current ? "var(--glow-live)" : undefined,
                  }}
                >
                  {done ? <Icon name="check" size={10} color="var(--text-on-accent)" /> : null}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: done || current ? "var(--text-primary)" : "var(--text-tertiary)" }}>{s.label}</span>
              </div>
            );
          })}
          <p style={{ margin: "var(--space-3) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
            Keep this open — don&apos;t close the tab until it finishes.
          </p>
        </div>
      )}

      {phase === "success" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "var(--space-5)", padding: "var(--space-5) 0" }}>
          <span style={{ width: 44, height: 44, borderRadius: 999, background: "var(--price-up-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="check" size={22} color="var(--price-up)" />
          </span>
          <div style={{ font: "var(--type-h3)", fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>{config.successTitle}</div>
          {(summary ?? config.successDetail) && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{summary ?? config.successDetail}</div>}
          {signature && config.explorerUrl && (
            <a href={config.explorerUrl(signature)} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-link)", textDecoration: "none" }}>
              View transaction <Icon name="external-link" size={12} />
            </a>
          )}
        </div>
      )}

      {phase === "error" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            <Icon name="alert-circle" size={18} color="var(--price-down)" />
            <span style={{ font: "var(--type-h3)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Transaction failed</span>
          </div>
          {config.errorHint && <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{config.errorHint}</p>}
          {error && (
            <p style={{ margin: 0, padding: "var(--space-5)", borderRadius: "var(--radius-sm)", background: "var(--surface-inset)", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--price-down)", wordBreak: "break-word" }}>{error}</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Row({ line }: { line: TxLine }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: line.strong ? "var(--text-md)" : "var(--text-sm)", color: line.muted ? "var(--text-tertiary)" : line.strong ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: line.strong ? "var(--weight-semibold)" : undefined }}>{line.label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: line.strong ? "var(--text-md)" : "var(--text-sm)", fontWeight: line.strong ? "var(--weight-semibold)" : undefined, color: line.strong ? "var(--accent)" : "var(--text-primary)" }}>{line.value}</span>
    </div>
  );
}
