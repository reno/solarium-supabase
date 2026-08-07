"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Input } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { createClient } from "@/lib/supabase/client";

/**
 * Start an enforced drop.
 *
 * Nothing is minted and no wallet is needed here — the drop's items don't exist until buyers mint
 * them out of the candy machine. This step just creates the collection and its artwork so there's
 * something to hang phases and a machine off, which is why it's a plain RLS-scoped insert while
 * the neighbouring quick mint needs a signature for every item.
 */

const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-4)",
};

const TEXTAREA: React.CSSProperties = {
  width: "100%",
  padding: "var(--space-5)",
  background: "var(--surface-inset)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-control)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-md)",
  resize: "vertical",
};

export function CreateDropForm({ creatorId }: { creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!file) {
          setError("Choose the artwork for this drop.");
          return;
        }
        setError(null);
        setBusy(true);
        try {
          const dropId = crypto.randomUUID();
          const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "png";
          const path = `${creatorId}/${dropId}/cover.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from("nft-media")
            .upload(path, file, { contentType: file.type || "image/png" });
          if (uploadError) throw new Error(`Artwork upload failed: ${uploadError.message}`);
          const coverUrl = supabase.storage.from("nft-media").getPublicUrl(path).data.publicUrl;

          const { data, error: insertError } = await supabase
            .from("collections")
            .insert({
              creator_id: creatorId,
              name: name.trim(),
              description: description.trim() || null,
              cover_url: coverUrl,
            })
            .select("id")
            .single();
          if (insertError) throw new Error(`Could not create the drop: ${insertError.message}`);

          showToast({ type: "success", title: "Drop created", message: name.trim() });
          router.push(`/launchpad/${data.id}`);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not create the drop.");
          setBusy(false);
        }
      }}
    >
      <label
        style={{
          display: "flex",
          cursor: "pointer",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-4)",
          padding: "var(--space-9)",
          borderRadius: "var(--radius-card)",
          border: "1px dashed var(--border-strong)",
          background: "var(--surface-inset)",
          fontSize: "var(--text-md)",
          color: "var(--text-tertiary)",
        }}
      >
        {preview ? (
          <Image
            src={preview}
            alt="Preview"
            width={320}
            height={320}
            style={{ maxHeight: 256, width: "auto", borderRadius: "var(--radius-media)", objectFit: "contain" }}
            unoptimized
          />
        ) : (
          <span>Click to choose the drop artwork</span>
        )}
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            if (chosen) setPreview(URL.createObjectURL(chosen));
          }}
        />
      </label>

      <div>
        <label style={FIELD_LABEL}>Name</label>
        <Input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Eclipse Pass" />
      </div>

      <div>
        <label style={FIELD_LABEL}>Description (optional)</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} style={TEXTAREA} />
      </div>

      {error && <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--price-down)" }}>{error}</p>}

      <div>
        <Button type="submit" variant="primary" icon="rocket" loading={busy} disabled={busy}>
          Create drop
        </Button>
        <span style={{ display: "block", marginTop: "var(--space-4)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          Next: add your phases, then deploy the candy machine that mints them.
        </span>
      </div>
    </form>
  );
}
