import type { CookieOptions } from "@supabase/ssr";

/**
 * Cookie settings for the Supabase session, shared by the browser client, the server client and
 * the proxy so all three agree — @supabase/ssr applies its own defaults per client otherwise,
 * and those defaults are `{ sameSite: "lax", httpOnly: false, maxAge: 400 days }` with no
 * `secure` at all.
 *
 * `httpOnly` is deliberately absent: the browser client has to read this cookie to attach the
 * access token to its requests, so it cannot be HTTP-only. That is what makes the CSP in
 * next.config.ts load-bearing rather than decorative, and it is also why the lifetime matters —
 * a token that can be read by script should not stay valid for well over a year.
 */
export const cookieOptions: CookieOptions = {
  path: "/",
  sameSite: "lax",
  // Never sent over plaintext in production. Off in development because the dev server is
  // http://localhost, where a Secure cookie is simply dropped.
  secure: process.env.NODE_ENV === "production",
  // Seven days rather than the 400-day default. Signing back in is one wallet prompt.
  maxAge: 60 * 60 * 24 * 7,
};
