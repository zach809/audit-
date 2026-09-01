import "./cwca-ui.css";
import type { Metadata } from "next";
import { Calistoga, Inter, JetBrains_Mono } from "next/font/google";

const uiFont = Inter({
  subsets: ["latin"],
  variable: "--font-cwca-ui",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-cwca-mono",
});

const displayFont = Calistoga({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-cwca-display",
});

export const metadata: Metadata = {
  title: "Clio Workflow Compliance Auditor",
  description: "Read-only workflow compliance auditing for Clio Manage.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${uiFont.variable} ${monoFont.variable} ${displayFont.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
