import type { SupabaseClient } from "@supabase/supabase-js";

import { MEDIA_BUCKET } from "@/lib/launchpad/manifest";

const UPLOAD_CONCURRENCY = 6;

export function publicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadTo(
  supabase: SupabaseClient,
  path: string,
  body: Blob | File,
  contentType: string,
  label: string
): Promise<string> {
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`${label} upload failed: ${error.message}`);
  return publicUrl(supabase, path);
}

export function uploadJson(
  supabase: SupabaseClient,
  path: string,
  body: unknown,
  label: string
): Promise<string> {
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  return uploadTo(supabase, path, blob, "application/json", label);
}

export type Progress = (done: number, total: number) => void;

export async function runPooled<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  onProgress?: Progress
): Promise<void> {
  let cursor = 0;
  let done = 0;
  let stopped = false;

  const runners = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, async () => {
    while (!stopped && cursor < items.length) {
      const index = cursor++;
      try {
        await worker(items[index], index);
      } catch (e) {
        stopped = true;
        throw e;
      }
      onProgress?.(++done, items.length);
    }
  });
  await Promise.all(runners);
}
