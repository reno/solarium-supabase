import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

/** Invoke the `settle` edge function, surfacing its own error message on failure. */
export async function invokeSettle(
  supabase: SupabaseClient,
  body: Record<string, string>
): Promise<Record<string, string>> {
  const { data, error } = await supabase.functions.invoke("settle", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context.json().catch(() => null as { error?: string } | null);
      throw new Error(details?.error ?? "Settlement request failed.");
    }
    throw error;
  }
  return data;
}
