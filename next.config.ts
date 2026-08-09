import type { NextConfig } from "next";

// Origins the browser is allowed to talk to. Both are NEXT_PUBLIC_ and therefore available at
// build time, which is when these headers are baked in — changing either one needs a redeploy,
// same as every other NEXT_PUBLIC_ value.
function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const rpcOrigin = originOf(process.env.NEXT_PUBLIC_SOLANA_RPC_URL);
// Icons are fetched from here at runtime by components/design/core/Icon.tsx.
const iconCdn = "https://cdn.jsdelivr.net";

const websocket = supabaseOrigin.replace(/^http/, "ws");

/**
 * Content Security Policy.
 *
 * Deliberately static rather than nonce-based. Next's nonce recipe requires generating a fresh
 * nonce per request in proxy.ts, which forces dynamic rendering on every page that carries a
 * script — this app renders most pages statically, and converting all of them is a bigger change
 * than a security header should drag in. So `script-src` and `style-src` keep 'unsafe-inline':
 * Next emits inline bootstrap scripts, and the UI is built almost entirely on React inline
 * `style` attributes, which are style-src-attr.
 *
 * What that costs and what it still buys is worth being precise about. It does NOT stop an
 * injected inline `<script>`. It DOES stop script loaded from any other origin, stop the page
 * being framed (clickjacking), stop `<base>` hijacking, stop form posts to another origin, and
 * confine images and network calls to known hosts — which is what keeps a stolen-token path from
 * ending anywhere useful, given the session cookie has to stay readable by JavaScript for the
 * Supabase browser client to work at all.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self'${[supabaseOrigin, websocket, rpcOrigin, iconCdn]
    .filter(Boolean)
    .map((o) => ` ${o}`)
    .join("")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // The version banner is free reconnaissance.
  poweredByHeader: false,

  images: {
    // Every next/image call site currently passes `unoptimized`, which skips the optimizer and
    // with it this allowlist — so the actual enforcement against an avatar_url pointing at an
    // arbitrary host is the CSP img-src above. This is here so that dropping `unoptimized`
    // later does not silently open it back up.
    remotePatterns: supabaseOrigin
      ? [{ protocol: "https", hostname: new URL(supabaseOrigin).hostname, pathname: "/storage/v1/object/public/**" }]
      : [],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Two years, matching the preload-list requirement. Only ever sent over HTTPS.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Redundant with frame-ancestors for modern browsers; cheap belt and braces.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
