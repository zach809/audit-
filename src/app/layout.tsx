import "./globals.css";
import "./docket.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clio Workflow Auditor",
  description: "Clio Workflow Auditor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-cwca-seed="43686ca8">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/*
          THESIS: A court exhibit sticker on a case file — what is missing, who owns it, what to do — not a SaaS metric dashboard.
          OWN-WORLD: Bond-paper docket, navy ink, exhibit marks (shape + official word). Sharp corners. Outfit UI, tabular mono numbers.
          STORY: A case manager finds today's owed work by name, sees their own name on the row, and opens Clio.
          FIRST VIEWPORT: Title, filters/tabs, then a ruled list of missing items with owner and action. Primary action is Open in Clio on the flagged row.
          FORM: Court exhibit sticker system (grounded list #5, seed 43686ca8). Raises: Crouwel cells, one token seed, invert-not-tint, cutting-bench flag, counterforce owner+action.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
