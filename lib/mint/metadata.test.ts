import { describe, expect, it } from "vitest";

import { buildNftMetadata, editionName } from "./metadata";

describe("editionName", () => {
  it("keeps the base name for single mints", () => {
    expect(editionName("Sunset", 1, 1)).toBe("Sunset");
  });

  it("numbers editions", () => {
    expect(editionName("Sunset", 3, 8)).toBe("Sunset #3/8");
  });
});

describe("buildNftMetadata", () => {
  it("builds the metaplex image metadata shape", () => {
    expect(
      buildNftMetadata({
        name: "Sunset",
        description: "dusk",
        imageUrl: "https://x/img.png",
        imageType: "image/png",
      })
    ).toEqual({
      name: "Sunset",
      description: "dusk",
      image: "https://x/img.png",
      properties: {
        files: [{ uri: "https://x/img.png", type: "image/png" }],
        category: "image",
      },
    });
  });

  it("defaults a missing description to empty string", () => {
    expect(
      buildNftMetadata({
        name: "S",
        description: null,
        imageUrl: "u",
        imageType: "t",
      }).description
    ).toBe("");
  });
});
