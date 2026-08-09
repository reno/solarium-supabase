"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { Icon } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { Avatar } from "@/components/profile/avatar";
import { assertUploadableImage, MAX_AVATAR_BYTES, safeExtension } from "@/lib/media/validate";
import { createClient } from "@/lib/supabase/client";

export function EditableAvatar({
  userId,
  username,
  avatarUrl,
  size,
  editable,
}: {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  size: number;
  editable: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [hover, setHover] = useState(false);

  if (!editable) {
    return <Avatar username={username} avatarUrl={avatarUrl} size={size} />;
  }

  const onFile = async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setUploading(true);
    try {
      await assertUploadableImage(file, "That image", MAX_AVATAR_BYTES);
      const ext = safeExtension(file.name, file.type);
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const publicUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);
      if (updateError) throw updateError;

      showToast({ type: "success", title: "Profile picture updated" });
      setUploading(false);
      router.refresh();
    } catch (e) {
      URL.revokeObjectURL(objectUrl);
      setPreview(null);
      setUploading(false);
      showToast({ type: "error", title: "Couldn't update picture", message: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={uploading}
      aria-label="Change profile picture"
      style={{
        position: "relative",
        display: "block",
        width: size,
        height: size,
        flex: "0 0 auto",
        padding: 0,
        border: "none",
        borderRadius: "var(--radius-pill)",
        background: "transparent",
        cursor: uploading ? "default" : "pointer",
      }}
    >
      <Avatar username={username} avatarUrl={preview ?? avatarUrl} size={size} />

      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-pill)",
          background: "var(--scrim)",
          color: "var(--text-on-accent)",
          opacity: uploading || hover ? 1 : 0,
          transition: "var(--transition-control)",
          pointerEvents: "none",
        }}
      >
        <Icon name={uploading ? "loader-circle" : "camera"} size={Math.round(size / 3.2)} className={uploading ? "sol-spin" : undefined} />
      </span>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </button>
  );
}
