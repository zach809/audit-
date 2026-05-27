import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CWCA Dashboard",
  description: "Clio Workflow Compliance Auditor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="night">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("cwca-theme");document.documentElement.dataset.theme=t==="day"?"day":"night"}catch(e){document.documentElement.dataset.theme="night"}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
