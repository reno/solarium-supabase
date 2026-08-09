"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Input } from "@/components/design";
import { assertUploadableImage, MAX_AVATAR_BYTES, safeExtension } from "@/lib/media/validate";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const MAX_BIO = 500;

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

export type ProfileFormInitial = {
  username: string | null;
  bio: string | null;
  avatarUrl: string | null;
};

export function ProfileForm({
  userId,
  initial,
}: {
  userId: string;
  initial: ProfileFormInitial;
}) {
  const [username, setUsername] = useState(initial.username ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(initial.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
      onSubmit={async (event) => {
        event.preventDefault();
        const name = username.trim().toLowerCase();
        if (!USERNAME_PATTERN.test(name)) {
          setError(
            "Username must be 3–30 characters: lowercase letters, numbers, or underscores."
          );
          return;
        }
        // The textarea caps this too; checked again here so the rule survives a paste that
        // outruns the attribute, and matches the CHECK constraint on profiles.bio.
        if (bio.trim().length > MAX_BIO) {
          setError(`Your bio must be ${MAX_BIO} characters or fewer.`);
          return;
        }
        setSaving(true);
        setError(null);
        try {
          let avatarUrl = initial.avatarUrl;
          if (avatarFile) {
            await assertUploadableImage(avatarFile, "Your profile picture", MAX_AVATAR_BYTES);
            const ext = safeExtension(avatarFile.name, avatarFile.type);
            const path = `${userId}/avatar-${Date.now()}.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from("avatars")
              .upload(path, avatarFile, { contentType: avatarFile.type });
            if (uploadError) throw uploadError;
            avatarUrl = supabase.storage.from("avatars").getPublicUrl(path)
              .data.publicUrl;
          }

          const { error: updateError } = await supabase
            .from("profiles")
            .upsert({
              id: userId,
              username: name,
              bio: bio.trim() || null,
              avatar_url: avatarUrl,
            });
          if (updateError) {
            if (updateError.code === "23505") {
              setError("That username is already taken.");
              return;
            }
            throw updateError;
          }

          router.push("/");
          router.refresh();
        } catch (e) {
          setError(friendlyError(e, "Failed to save profile."));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-7)" }}>
        <div style={{ width: 64, height: 64, borderRadius: "var(--radius-pill)", overflow: "hidden", background: avatarPreview ? "var(--surface-inset)" : "conic-gradient(from 180deg, var(--solar-2), var(--cyan-2), var(--solar-3))", flex: "0 0 auto" }}>
          {avatarPreview && (
            <Image src={avatarPreview} alt="Avatar preview" width={64} height={64} style={{ height: "100%", width: "100%", objectFit: "cover" }} unoptimized />
          )}
        </div>
        <label style={{ cursor: "pointer", fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--accent)" }}>
          Upload avatar
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setAvatarFile(file);
              if (file) setAvatarPreview(URL.createObjectURL(file));
            }}
          />
        </label>
      </div>

      <div>
        <label style={FIELD_LABEL}>Username</label>
        <Input required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="your_name" autoComplete="off" />
      </div>

      <div>
        <label style={FIELD_LABEL}>Bio (optional)</label>
        <textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} maxLength={500} placeholder="Tell collectors about yourself" style={TEXTAREA} />
      </div>

      {error && <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--price-down)" }}>{error}</p>}

      <div>
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>Save profile</Button>
      </div>
    </form>
  );
}
