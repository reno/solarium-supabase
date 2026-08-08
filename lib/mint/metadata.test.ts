import { describe, expect, it } from "vitest";

import { buildNftMetadata, itemName } from "./metadata";

describe("itemName", () => {
  it("keeps the base name for a standalone 1/1", () => {
    expect(itemName("Sunset", 1, 1)).toBe("Sunset");
  });

  it("numbers items in a multi-item collection (no /total)", () => {
    expect(itemName("Sunset", 3, 8)).toBe("Sunset #3");
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
