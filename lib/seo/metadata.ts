import type { Metadata } from "next";

import { SITE_NAME, absoluteUrl } from "@/lib/seo/site";

export interface PageMetadataInput {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  imageAlt?: string;
}

export function pageMetadata({ title, description, path, image, imageAlt }: PageMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const images = image ? [{ url: image, alt: imageAlt ?? title }] : undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title,
      description,
      url,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(images ? { images } : {}),
    },
  };
}

export function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}
