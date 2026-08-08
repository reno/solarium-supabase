"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Button, Card, Icon } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import {
  clearPendingMint,
  pendingMintsSnapshot,
  subscribePendingMints,
  NO_PENDING_MINTS,
} from "@/lib/launchpad/pending-mints";
import { invokeFunction } from "@/lib/settle/invoke";
import { createClient } from "@/lib/supabase/client";

/**
 * Finishing a mint that landed on chain but never got recorded.
 *
 * Minting is two steps that can't be made one: the buyer's wallet signs, and then `candy-mint`
 * re-derives the asset from the chain and inserts the row (buyers can't insert into `nfts`
 * themselves). If the second step fails the item is still theirs, but nothing in the app knows —
 * and re-minting would buy a second item rather than recover the first. So the mint is kept in
 * local storage and replayed from here.
 *
 * Retrying is safe to do at any time: `candy-mint` is idempotent on the asset address and returns
 * the existing row rather than inserting twice, so a record left stale by another tab clears
 * itself on the first retry.
 */
export function PendingMintNotice({ collectionId }: { collectionId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing on the server, where local storage doesn't exist — rendering from it directly would
  // mismatch the markup the page was sent with.
  const all = useSyncExternalStore(subscribePendingMints, pendingMintsSnapshot, () => NO_PENDING_MINTS);
  const pending = useMemo(() => all.filter((r) => r.collectionId === collectionId), [all, collectionId]);

  if (pending.length === 0) return null;

  const record = async () => {
    setBusy(true);
    setError(null);
    let recorded = 0;
    try {
      for (const mint of pending) {
        await invokeFunction(
          supabase,
          "candy-mint",
          { collectionId, assetAddress: mint.assetAddress, signature: mint.signature },
          "Recording the mint failed."
        );
        clearPendingMint(mint.assetAddress);
        recorded++;
      }
      showToast({
        type: "success",
        title: recorded === 1 ? "Mint recorded" : `${recorded} mints recorded`,
        message: "It's in your portfolio now.",
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording the mint failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="var(--space-7)" style={{ marginBottom: "var(--space-7)", border: "1px solid var(--price-down)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-5)" }}>
        <Icon name="triangle-alert" size={16} color="var(--price-down)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
            {pending.length === 1 ? "A mint is waiting to be recorded" : `${pending.length} mints are waiting to be recorded`}
          </div>
          <p style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)", margin: "var(--space-4) 0 0", textWrap: "pretty" }}>
            {pending.length === 1 ? "It is" : "They are"} already yours on chain — only the app&apos;s copy is
            missing, so don&apos;t mint again. Recording {pending.length === 1 ? "it" : "them"} costs nothing and
            needs no signature.
          </p>
          <div style={{ marginTop: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
            {pending.map((mint) => (
              <div key={mint.assetAddress}>{mint.assetAddress}</div>
            ))}
          </div>
          {error && (
            <p style={{ font: "var(--type-body-sm)", color: "var(--price-down)", margin: "var(--space-4) 0 0" }}>{error}</p>
          )}
          <div style={{ marginTop: "var(--space-5)" }}>
            <Button variant="primary" size="sm" icon="refresh-cw" loading={busy} disabled={busy} onClick={record}>
              {pending.length === 1 ? "Finish recording" : "Finish recording all"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
