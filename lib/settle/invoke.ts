import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

export async function invokeFunction(
  supabase: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
  fallbackMessage = "Request failed."
): Promise<Record<string, string>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context
        .json()
        .catch(() => null as { error?: string } | null);
      // Only `error` is read, because that is the envelope *our* functions return. A 502/503
      // from the API gateway — the function not deployed, its container not running — is JSON
      // too, but shaped `{ message: … }`, and forwarding that told a buyer their mint failed
      // with "name resolution failed", which is Kong's problem described in Kong's words.
      throw new Error(details?.error ?? fallbackMessage);
    }
    throw error;
  }
  return data;
}

export async function invokeSettle(
  supabase: SupabaseClient,
  body: Record<string, string>
): Promise<Record<string, string>> {
  return invokeFunction(supabase, "settle", body, "Settlement request failed.");
}
