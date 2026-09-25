import type { Metadata } from "next";

// Sep 25 (per Mely — resident portal installable as its own app, same
// as admin dashboard and Propane Scanner today): only /residents links
// to the dynamic per-company manifest (api/resident-manifest) and
// registers its own service worker — the rest of this site (marketing
// pages, Apply, Reservations) stays a normal website, not installable.
export const metadata: Metadata = {
  manifest: "/api/resident-manifest",
};

export default function ResidentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if ("serviceWorker" in navigator) {
              navigator.serviceWorker.register("/residents-sw.js", { scope: "/residents" }).catch(function () {});
            }
          `,
        }}
      />
    </>
  );
}
