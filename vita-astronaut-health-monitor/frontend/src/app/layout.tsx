import type { Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "@/components/providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-sans-face", subsets: ["latin", "cyrillic"], weight: ["400", "500", "600", "700"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-mono-face", subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], display: "swap" });

// Tints the browser UI (mobile address bar) to match each theme's canvas.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#050608" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The init script sets data-theme / data-sidebar before hydration, hence suppressHydrationWarning.
    <html lang="uk" data-theme="dark" className={`${sans.variable} ${mono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script
          data-errno-theme-init
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="min-h-screen font-sans">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
