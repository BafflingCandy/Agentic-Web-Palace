import type { Metadata } from "next";
import { Poppins, Teko } from "next/font/google";
import { RouteTransitionProvider } from "@/components/RouteTransitionProvider";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap"
});

const teko = Teko({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap"
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Web Palace | Visual Knowledge Registry",
  description:
    "A minimal visual registry for navigating subject websites as an interactive node graph.",
  openGraph: {
    title: "Web Palace | Visual Knowledge Registry",
    description:
      "A minimal visual registry for navigating subject websites as an interactive node graph.",
    images: ["/images/memory-map-hero.png"]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} ${teko.variable}`}>
        <RouteTransitionProvider>{children}</RouteTransitionProvider>
      </body>
    </html>
  );
}
