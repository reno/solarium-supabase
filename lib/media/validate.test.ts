import { describe, expect, it } from "vitest";

import { assertUploadableImage, MAX_AVATAR_BYTES, safeExtension } from "@/lib/media/validate";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

function fileOf(name: string, type: string, header: number[] = PNG_HEADER, size = 1024): File {
  const body = new Uint8Array(size);
  body.set(header.slice(0, Math.min(header.length, size)));
  return new File([body], name, { type });
}

describe("safeExtension", () => {
  it("keeps a recognised extension", () => {
    expect(safeExtension("art.PNG", "image/png")).toBe("png");
    expect(safeExtension("art.jpeg", "image/jpeg")).toBe("jpeg");
    expect(safeExtension("a.b.c.webp", "image/webp")).toBe("webp");
  });

  it("refuses anything that is not on the allowlist", () => {
    expect(safeExtension("x.png/../../other/cover.png", "image/png")).toBe("png");
    expect(safeExtension("x.svg", "image/png")).toBe("png");
    expect(safeExtension("x.php", "image/jpeg")).toBe("jpg");
    expect(safeExtension("x.png%2f..%2fy", "image/webp")).toBe("webp");
    expect(safeExtension("no-extension-at-all", "image/gif")).toBe("gif");
  });

  it("falls back to png when the content type is unknown too", () => {
    expect(safeExtension("mystery.exe", "application/octet-stream")).toBe("png");
    expect(safeExtension("mystery")).toBe("png");
  });

  it("never returns a value containing a path separator", () => {
    const hostile = ["a.png/../b", "a./..", "a.\\..\\b", "a.%2e%2e"];
    for (const name of hostile) {
      expect(safeExtension(name, "image/png")).not.toMatch(/[/\\%.]/);
    }
  });
});

describe("assertUploadableImage", () => {
  it("accepts a real PNG", async () => {
    await expect(assertUploadableImage(fileOf("a.png", "image/png"), "Cover")).resolves.toBeUndefined();
  });

  it("rejects SVG, which is the stored-XSS case", async () => {
    await expect(
      assertUploadableImage(fileOf("a.svg", "image/svg+xml", [0x3c, 0x73, 0x76, 0x67]), "Cover")
    ).rejects.toThrow(/PNG, JPEG, WebP, GIF or AVIF/);
  });

  it("rejects a file whose bytes disagree with its label", async () => {
    const svgBytesLabelledPng = fileOf("a.png", "image/png", [0x3c, 0x73, 0x76, 0x67, 0x20]);
    await expect(assertUploadableImage(svgBytesLabelledPng, "Cover")).rejects.toThrow(
      /does not look like an image/
    );
  });

  it("enforces the size limit", async () => {
    const big = fileOf("a.png", "image/png", PNG_HEADER, MAX_AVATAR_BYTES + 1);
    await expect(assertUploadableImage(big, "Avatar", MAX_AVATAR_BYTES)).rejects.toThrow(/the limit is/);
  });

  it("rejects an empty file", async () => {
    await expect(assertUploadableImage(fileOf("a.png", "image/png", [], 0), "Cover")).rejects.toThrow(
      /is empty/
    );
  });
});
