import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/profile/profile-form";
import { createClient } from "@/lib/supabase/server";

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
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Set up your profile
      </h1>
      <p className="mt-2 mb-8 text-zinc-600 dark:text-zinc-400">
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
