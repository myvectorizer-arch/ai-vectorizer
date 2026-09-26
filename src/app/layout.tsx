import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "AI Vectorizer · Convert Images to Vectors Online",
  description:
    "Vectorize PNG, JPG, GIF, WebP, BMP and TIFF images into clean SVG, PDF, EPS and DXF vectors. AI-powered tracing for logos, print, web, CAD and CNC workflows.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-[#111827] antialiased">
        <Providers>
          <SiteHeader />
          <main className="min-h-[60vh]">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
