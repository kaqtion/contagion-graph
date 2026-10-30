import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const sans = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Contagion Graph · every headline has a blast radius", template: "%s · Contagion Graph" },
  description:
    "Paste a headline and see which companies get hurt or helped, through which supply-chain links, with the filing quote behind every edge.",
  openGraph: {
    title: "Contagion Graph",
    description: "Trace a news shock through supplier, customer, competitor, region and commodity links, with the SEC filing quote behind every edge.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#0b0c0e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="antialiased min-h-dvh flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-origin focus:text-[#17120a] text-[13px] font-medium"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main" className="flex-1 flex flex-col min-h-0">
          {children}
        </main>
        <footer className="h-10 border-t border-line px-4 sm:px-6 text-[11px] text-faint flex items-center gap-x-6 justify-between overflow-hidden">
          <span className="truncate">Not financial advice. Scores describe known supply-chain links, not price predictions.</span>
          <span className="hidden md:inline num shrink-0">SEC EDGAR · curated links · GDELT &amp; Google News</span>
        </footer>
      </body>
    </html>
  );
}
