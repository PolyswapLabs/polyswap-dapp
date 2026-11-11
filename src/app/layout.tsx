import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/utils/cn";
import { ConsoleSignature } from "./ConsoleSignature";
import { SITE_URL } from "@/server/seo";

const sans = localFont({
  src: "./fonts/InterTight-latin.woff2",
  weight: "400 700",
  variable: "--font-sans",
  display: "swap",
});

const serif = localFont({
  src: [
    { path: "./fonts/Fraunces-latin.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/Fraunces-italic-latin.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

const mono = localFont({
  src: "./fonts/JetBrainsMono-latin.woff2",
  weight: "400 600",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    apple: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(sans.variable, serif.variable, mono.variable)}>
      <body className="bg-paper text-ink antialiased">
        <ConsoleSignature />
        {children}
      </body>
    </html>
  );
}
