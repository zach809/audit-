import "./globals.css";
import "./design-system.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clio Workflow Auditor",
  description: "Clio Workflow Auditor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
