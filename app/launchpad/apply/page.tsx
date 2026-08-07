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
      <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>Apply to launch</h1>
      <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "var(--space-4) 0 var(--space-9)", maxWidth: 560 }}>
        Vetted drops mint on Solarium&apos;s launchpad. Tell us about your collection — review takes 2–3 business days.
      </p>
      <ApplyWizard creatorId={user.id} />
    </main>
  );
}
