import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/profile/profile-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up your profile",
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, bio, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-13) var(--page-gutter)" }}>
      <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>
        Set up your profile
      </h1>
      <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "var(--space-4) 0 var(--space-10)" }}>
        Pick a username so collectors and creators can find you.
      </p>
      <ProfileForm
        userId={user.id}
        initial={{
          username: profile?.username ?? null,
          bio: profile?.bio ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
    </main>
  );
}
