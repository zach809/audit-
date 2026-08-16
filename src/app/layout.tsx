import "./globals.css";
import "./docket.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clio Workflow Auditor",
  description: "Clio Workflow Auditor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-cwca-seed="cwca19-terminal">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;0,800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/*
          THESIS: An airport sign for owed work — the next destination, not a metric dashboard or exhibit sticker.
          OWN-WORLD: Cool concourse wall, near-black sign panels, white humanist type, white pictograms on black squares, saturated yellow only when a person must act. Source Sans 3. Sharp rectangles.
          STORY: A case manager glances, reads the monumental owed count, finds a named row, and takes the labelled action at the trailing edge.
          FIRST VIEWPORT: Full-width header sign with title plus owed count at monumental tabular scale, then black wayfinding tabs with white type, then dark destination rows. Primary action sits on the row's trailing edge.
          FORM: Terminal Wayfinding, brief-pinned CWCA-19, seed cwca19-terminal. No concept roll.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
