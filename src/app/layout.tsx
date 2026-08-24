import "./globals.css";
import "./design-system.css";
import type { Metadata } from "next";
import { Calistoga, Inter, JetBrains_Mono } from "next/font/google";

const displayFont = Calistoga({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-cwca-display",
});

const uiFont = Inter({
  subsets: ["latin"],
  variable: "--font-cwca-ui",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-cwca-mono",
});

export const metadata: Metadata = {
  title: "CWCA Clio Workflow Compliance Auditor",
  description: "Read-only workflow compliance auditing for Clio Manage.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${uiFont.variable} ${monoFont.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
