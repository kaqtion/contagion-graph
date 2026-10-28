import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Contagion Graph",
  description:
    "Paste a headline and see which companies get hurt or helped, through which supply-chain links, with the filing quote behind every edge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable} antialiased min-h-dvh flex flex-col`}>
        <Nav />
        <main className="flex-1 flex flex-col min-h-0">{children}</main>
        <footer className="border-t border-line px-4 sm:px-6 py-3 text-[11px] text-faint flex flex-wrap gap-x-4 gap-y-1 justify-between">
          <span>Not financial advice. Exposure scores describe known supply-chain links, not price predictions.</span>
          <span>Data: SEC EDGAR filings, curated links, GDELT news.</span>
        </footer>
      </body>
    </html>
  );
}
