import { redirect } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { ApplyWizard } from "@/components/launchpad/apply-wizard";
import { createClient } from "@/lib/supabase/server";

export default async function ApplyToLaunchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/launchpad");

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-11) var(--page-gutter) var(--space-13)" }}>
      <div style={{ marginBottom: "var(--space-8)" }}>
        <BackLink label="Launchpad" />
      </div>
      <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>Launch a collection</h1>
      <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "var(--space-4) 0 var(--space-9)", maxWidth: 560 }}>
        Set up your drop and its phases. Nothing is minted here — the last step deploys a candy machine
        that mints items to buyers and enforces your rules on chain.
      </p>
      <ApplyWizard creatorId={user.id} />
    </main>
  );
}
