import type { SupabaseClient } from "@supabase/supabase-js";

import { MEDIA_BUCKET } from "@/lib/launchpad/manifest";

// A 250-item drop is 250 images plus 250 metadata JSONs. Serially that is minutes of round
// trips; a small pool keeps it to seconds without tripping storage rate limits.
const UPLOAD_CONCURRENCY = 6;

export function publicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Every upload here is an upsert: a deploy that dies halfway is re-run from the top, and the
// second run must overwrite what the first one wrote rather than fail on "already exists".
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
        // One failure ends the whole batch: the remaining runners would only pile up more of
        // the same error, and Promise.all reports the first one either way.
        stopped = true;
        throw e;
      }
      onProgress?.(++done, items.length);
    }
  });
  await Promise.all(runners);
}
