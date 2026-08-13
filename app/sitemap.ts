import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo/site";
import { createAnonClient } from "@/lib/supabase/anon";

export const revalidate = 3600;

const PAGE_SIZE = 1000;

type Row = Record<string, unknown>;

async function paginate<T extends Row>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const { data } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAnonClient();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "hourly", priority: 1 },
    { url: absoluteUrl("/collections"), changeFrequency: "hourly", priority: 0.9 },
    { url: absoluteUrl("/launchpad"), changeFrequency: "hourly", priority: 0.9 },
  ];

  const [collections, drops, profiles] = await Promise.all([
    paginate<{ id: string; created_at: string }>((from, to) =>
      supabase.from("collections").select("id, created_at").order("created_at", { ascending: false }).range(from, to)
    ),
    paginate<{ collection_id: string }>((from, to) =>
      supabase.from("mint_phases").select("collection_id").range(from, to)
    ),
    paginate<{ username: string }>((from, to) =>
      supabase.from("profiles").select("username").not("username", "is", null).range(from, to)
    ),
  ]);

  const dropIds = new Set(drops.map((d) => d.collection_id));

  return [
    ...staticRoutes,
    ...collections.map((c) => ({
      url: absoluteUrl(`/collections/${c.id}`),
      lastModified: new Date(c.created_at),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...collections
      .filter((c) => dropIds.has(c.id))
      .map((c) => ({
        url: absoluteUrl(`/launchpad/${c.id}`),
        lastModified: new Date(c.created_at),
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
    ...profiles.map((p) => ({
      url: absoluteUrl(`/u/${encodeURIComponent(p.username)}`),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
