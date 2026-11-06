import type { Metadata, Viewport } from "next";
import { Caveat, Geist } from "next/font/google";
import { WGProvider } from "@/lib/wg";
import { Gate } from "@/components/Gate";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
// Handschrift für die Post-its auf der Pinnwand
const hand = Caveat({ variable: "--font-caveat", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WG-App",
  description: "Putzplan, Einkaufsliste, Kosten, Kalender und To-dos für eure WG",
  appleWebApp: { capable: true, title: "WG", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className={`${geist.variable} ${hand.variable} antialiased`}>
        <WGProvider>
          <Gate>{children}</Gate>
        </WGProvider>
      </body>
    </html>
  );
}
