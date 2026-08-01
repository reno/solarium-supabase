"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

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
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const name = username.trim().toLowerCase();
        if (!USERNAME_PATTERN.test(name)) {
          setError(
            "Username must be 3–30 characters: lowercase letters, numbers, or underscores."
          );
          return;
        }
        setSaving(true);
        setError(null);
        try {
          let avatarUrl = initial.avatarUrl;
          if (avatarFile) {
            const ext = avatarFile.name.split(".").pop() ?? "png";
            const path = `${userId}/avatar-${Date.now()}.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from("avatars")
              .upload(path, avatarFile, { contentType: avatarFile.type });
            if (uploadError) throw uploadError;
            avatarUrl = supabase.storage.from("avatars").getPublicUrl(path)
              .data.publicUrl;
          }

          // Upsert rather than update so a missing profile row (e.g. deleted
          // out-of-band) is recreated instead of silently matching zero rows.
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
          setError(e instanceof Error ? e.message : "Failed to save profile.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          {avatarPreview && (
            <Image
              src={avatarPreview}
              alt="Avatar preview"
              width={64}
              height={64}
              className="h-full w-full object-cover"
              unoptimized
            />
          )}
        </div>
        <label className="cursor-pointer text-sm font-medium text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300">
          Upload avatar
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setAvatarFile(file);
              if (file) setAvatarPreview(URL.createObjectURL(file));
            }}
          />
        </label>
      </div>

      <label className="flex flex-col gap-2 text-sm font-medium">
        Username
        <input
          type="text"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="your_name"
          autoComplete="off"
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        Bio <span className="font-normal text-zinc-500">(optional)</span>
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Tell collectors about yourself"
          className="resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </label>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
