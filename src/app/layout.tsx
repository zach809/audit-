import "./globals.css";
import "./design-system.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CWCA Clio Workflow Compliance Auditor",
  description: "Read-only workflow compliance auditing for Clio Manage.",
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
