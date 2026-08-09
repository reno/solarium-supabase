"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge, Button, Card, Icon } from "@/components/design";
import { Countdown } from "@/components/launchpad/countdown";
import { useToast } from "@/components/toast/toast-provider";
import { invokeFunction } from "@/lib/settle/invoke";
import { createClient } from "@/lib/supabase/client";

export function RevealPanel({
  collectionId,
  revealAt,
  now,
}: {
  collectionId: string;
  revealAt: string | null;
  now: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!revealAt) return null;

  const due = new Date(revealAt).getTime() <= now * 1000;

  const doReveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await invokeFunction(supabase, "reveal", { collectionId }, "Revealing the drop failed.");
      showToast({
        type: "success",
        title: "Items revealed",
        message: `${result?.items ?? ""} items now show their real artwork.`.trim(),
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revealing the drop failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="var(--space-8)" style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <span className="sol-label" style={{ color: "var(--text-primary)" }}>
          Reveal
        </span>
        {due ? <Badge tone="live">Ready</Badge> : <Badge tone="neutral">Scheduled</Badge>}
      </div>

      {due ? (
        <>
          <p style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            The reveal time has passed. Publishing rewrites every item&apos;s metadata with its real artwork and
            traits, and fills in the rarity of everything minted so far. No wallet approval, no transaction — the
            on-chain URIs don&apos;t change, only what they point at.
          </p>
          <Button variant="primary" icon="eye" loading={busy} disabled={busy} onClick={doReveal}>
            Reveal items
          </Button>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
          <Icon name="alert-circle" size={14} color="var(--accent)" style={{ position: "relative", top: 2 }} />
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            Items mint as placeholders and their traits stay hidden for{" "}
            <Countdown target={revealAt} now={now} style={{ color: "var(--accent)" }} />. Buyers can&apos;t see
            which item they got, and neither can a bot picking mints — that is the point of the delay.
          </span>
        </div>
      )}

      {error && (
        <p style={{ margin: "var(--space-6) 0 0", fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>
      )}
    </Card>
  );
}
