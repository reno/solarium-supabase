import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { SiteHeader } from "@/components/site-header";
import { ToastProvider } from "@/components/toast/toast-provider";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Solarium design-system type: Space Grotesk (UI text) + JetBrains Mono (every number).
// See app/design-tokens.css — components/design/* reference these via --font-sans/--font-mono.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Solarium",
  description: "Mint, collect and trade Solana NFTs.",
};

// Runs before first paint: resolves the stored theme (or OS preference) and stamps
// [data-theme] on <html>, so design-tokens.css and the --background base var agree
// with no flash. The static data-theme="dark" below is only the SSR/no-JS default.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('solarium:theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <Providers>
          <ToastProvider>
            <SiteHeader />
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
