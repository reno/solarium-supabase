import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

/** Invoke an edge function, surfacing its own error message rather than a generic HTTP one. */
export async function invokeFunction(
  supabase: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
  fallbackMessage = "Request failed."
): Promise<Record<string, string>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context.json().catch(() => null as { error?: string } | null);
      throw new Error(details?.error ?? fallbackMessage);
    }
    throw error;
  }
  return data;
}

/** Invoke the `settle` edge function, surfacing its own error message on failure. */
export async function invokeSettle(
  supabase: SupabaseClient,
  body: Record<string, string>
): Promise<Record<string, string>> {
  return invokeFunction(supabase, "settle", body, "Settlement request failed.");
}
