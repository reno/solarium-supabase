import { SITE_NAME, SITE_TAGLINE, absoluteUrl } from "@/lib/seo/site";

type Json = Record<string, unknown>;

function prune(node: Json): Json {
  return Object.fromEntries(Object.entries(node).filter(([, v]) => v != null && v !== ""));
}

export function breadcrumbJsonLd(trail: Array<{ name: string; path: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

export function websiteJsonLd(): Json[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      description: SITE_TAGLINE,
      url: absoluteUrl("/"),
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url: absoluteUrl("/"),
      logo: absoluteUrl("/logo.svg"),
    },
  ];
}

export function productJsonLd({
  name,
  description,
  path,
  image,
  collectionName,
  collectionPath,
  traits,
}: {
  name: string;
  description?: string | null;
  path: string;
  image?: string | null;
  collectionName?: string | null;
  collectionPath?: string | null;
  traits?: Array<{ trait: string; value: string }>;
}): Json {
  return prune({
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description: description ?? undefined,
    url: absoluteUrl(path),
    image: image ?? undefined,
    isPartOf:
      collectionName && collectionPath
        ? { "@type": "Collection", name: collectionName, url: absoluteUrl(collectionPath) }
        : undefined,
    additionalProperty: traits?.length
      ? traits.map((t) => ({ "@type": "PropertyValue", name: t.trait, value: t.value }))
      : undefined,
  });
}

export function collectionPageJsonLd({
  name,
  description,
  path,
  image,
  items,
}: {
  name: string;
  description?: string | null;
  path: string;
  image?: string | null;
  items: Array<{ name: string; path: string }>;
}): Json {
  return prune({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description: description ?? undefined,
    url: absoluteUrl(path),
    image: image ?? undefined,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.name,
        url: absoluteUrl(item.path),
      })),
    },
  });
}

export function profilePageJsonLd({
  username,
  bio,
  path,
  avatarUrl,
}: {
  username: string;
  bio?: string | null;
  path: string;
  avatarUrl?: string | null;
}): Json {
  return prune({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: absoluteUrl(path),
    mainEntity: prune({
      "@type": "Person",
      name: `@${username}`,
      alternateName: username,
      description: bio ?? undefined,
      image: avatarUrl ?? undefined,
      url: absoluteUrl(path),
    }),
  });
}
