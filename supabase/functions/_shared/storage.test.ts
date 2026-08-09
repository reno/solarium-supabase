import { afterEach, describe, expect, it } from "vitest";

import { internalStorageUrl, isMarketplaceStorageUrl, storagePrefixes } from "./storage";

const env: Record<string, string> = {};
(globalThis as { Deno?: unknown }).Deno = {
  env: { get: (key: string) => env[key] },
};

function setEnv(values: Record<string, string | undefined>) {
  for (const key of Object.keys(env)) delete env[key];
  for (const [key, value] of Object.entries(values)) if (value !== undefined) env[key] = value;
}

afterEach(() => setEnv({}));

const HOSTED = "https://xitjjgxpzksejjotelyi.supabase.co";
const BROWSER_LOCAL = "http://127.0.0.1:54321";
const CONTAINER_LOCAL = "http://kong:8000";

describe("storagePrefixes", () => {
  it("accepts SUPABASE_URL on its own", () => {
    setEnv({ SUPABASE_URL: HOSTED });
    expect(storagePrefixes()).toEqual([`${HOSTED}/storage/v1/object/public/`]);
  });

  it("adds the configured public origins ahead of it", () => {
    setEnv({ SUPABASE_URL: CONTAINER_LOCAL, STORAGE_PUBLIC_URL: BROWSER_LOCAL });
    expect(storagePrefixes()).toEqual([
      `${BROWSER_LOCAL}/storage/v1/object/public/`,
      `${CONTAINER_LOCAL}/storage/v1/object/public/`,
    ]);
  });

  it("takes a comma-separated list, and tolerates spacing and trailing slashes", () => {
    setEnv({ SUPABASE_URL: `${CONTAINER_LOCAL}/`, STORAGE_PUBLIC_URL: ` ${BROWSER_LOCAL}/ , ${HOSTED} ` });
    expect(storagePrefixes()).toEqual([
      `${BROWSER_LOCAL}/storage/v1/object/public/`,
      `${HOSTED}/storage/v1/object/public/`,
      `${CONTAINER_LOCAL}/storage/v1/object/public/`,
    ]);
  });

  it("does not repeat an origin that is configured twice", () => {
    setEnv({ SUPABASE_URL: HOSTED, STORAGE_PUBLIC_URL: HOSTED });
    expect(storagePrefixes()).toHaveLength(1);
  });

  it("refuses to guess when nothing is configured", () => {
    setEnv({});
    expect(() => storagePrefixes()).toThrow(/SUPABASE_URL is not configured/);
  });
});

describe("isMarketplaceStorageUrl", () => {
  it("recognises a uri written by the browser while running inside the container", () => {
    setEnv({ SUPABASE_URL: CONTAINER_LOCAL, STORAGE_PUBLIC_URL: BROWSER_LOCAL });
    expect(isMarketplaceStorageUrl(`${BROWSER_LOCAL}/storage/v1/object/public/nft-media/a/b/1.json`)).toBe(true);
  });

  it("recognises the hosted case, where both names agree", () => {
    setEnv({ SUPABASE_URL: HOSTED });
    expect(isMarketplaceStorageUrl(`${HOSTED}/storage/v1/object/public/nft-media/a/b/1.json`)).toBe(true);
  });

  it("still rejects somewhere else entirely — this is the SSRF guard", () => {
    setEnv({ SUPABASE_URL: HOSTED });
    expect(isMarketplaceStorageUrl("https://evil.test/storage/v1/object/public/x.json")).toBe(false);
    expect(isMarketplaceStorageUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isMarketplaceStorageUrl("file:///etc/passwd")).toBe(false);
    expect(isMarketplaceStorageUrl(`${HOSTED}.evil.test/storage/v1/object/public/x.json`)).toBe(false);
    expect(isMarketplaceStorageUrl(`${HOSTED}/storage/v1/object/authenticated/x.json`)).toBe(false);
  });

  it("rejects non-strings rather than throwing", () => {
    setEnv({ SUPABASE_URL: HOSTED });
    expect(isMarketplaceStorageUrl(undefined)).toBe(false);
    expect(isMarketplaceStorageUrl(null)).toBe(false);
    expect(isMarketplaceStorageUrl(42)).toBe(false);
  });
});

describe("internalStorageUrl", () => {
  it("re-addresses a browser-facing url so the container can actually reach it", () => {
    setEnv({ SUPABASE_URL: CONTAINER_LOCAL, STORAGE_PUBLIC_URL: BROWSER_LOCAL });
    expect(internalStorageUrl(`${BROWSER_LOCAL}/storage/v1/object/public/nft-media/a/1.json`)).toBe(
      `${CONTAINER_LOCAL}/storage/v1/object/public/nft-media/a/1.json`
    );
  });

  it("is a no-op when the two origins are the same, as in production", () => {
    setEnv({ SUPABASE_URL: HOSTED });
    const url = `${HOSTED}/storage/v1/object/public/nft-media/a/1.json`;
    expect(internalStorageUrl(url)).toBe(url);
  });

  it("keeps the query string", () => {
    setEnv({ SUPABASE_URL: CONTAINER_LOCAL, STORAGE_PUBLIC_URL: BROWSER_LOCAL });
    expect(internalStorageUrl(`${BROWSER_LOCAL}/storage/v1/object/public/x.json?v=2`)).toBe(
      `${CONTAINER_LOCAL}/storage/v1/object/public/x.json?v=2`
    );
  });
});
