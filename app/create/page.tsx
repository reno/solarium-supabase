import { redirect } from "next/navigation";

// Create is retired — minting now lives inside the Launchpad creator hub.
export default function CreatePage() {
  redirect("/launchpad");
}
