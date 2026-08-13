import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/portfolio", "/creator", "/welcome", "/launchpad/apply"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
