export const SITE_NAME = "Solarium";

export const SITE_TAGLINE = "Mint, collect and trade Solana NFTs.";

export const SITE_TITLE = "Solarium — Mint, collect and trade Solana NFTs";

export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return new URL(path.startsWith("/") ? path : `/${path}`, `${siteUrl()}/`).toString();
}
