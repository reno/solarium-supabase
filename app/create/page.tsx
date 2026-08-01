import { redirect } from "next/navigation";

import { MintForm } from "@/components/mint/mint-form";
import { createClient } from "@/lib/supabase/server";

export default async function CreatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create</h1>
      <p className="mt-2 mb-8 text-zinc-600 dark:text-zinc-400">
        Mint an image as one or more numbered editions. Minting happens in your
        wallet; you pay only the network fees.
      </p>
      <MintForm creatorId={user.id} />
    </main>
  );
}
