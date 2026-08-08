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
        .catch(() => null as { error?: string; message?: string } | null);
      throw new Error(details?.error ?? details?.message ?? fallbackMessage);
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
