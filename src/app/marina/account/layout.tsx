import type { Metadata, Viewport } from "next";

// Oct 26 (per Mely): only the boater account links the marina app manifest and registers its
// service worker, so the account installs as the marina's own app; the public site stays a website.
export const metadata: Metadata = {
  manifest: "/api/marina/app/manifest",
  appleWebApp: { capable: true, title: "Boater", statusBarStyle: "default" },
  icons: { apple: "/api/marina/app/icon?size=180" },
};
export const viewport: Viewport = { themeColor: "#0f2540" };

export default function MarinaAccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <script
        dangerouslySetInnerHTML={{
          __html: `if ("serviceWorker" in navigator) { navigator.serviceWorker.register("/marina-sw.js", { scope: "/marina" }).catch(function () {}); }`,
        }}
      />
    </>
  );
}
