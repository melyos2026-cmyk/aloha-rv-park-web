import type { Metadata } from "next";

// Page <title> for the public legal page (required by the A2P campaign
// review: the page must be titled exactly like its subject).
export const metadata: Metadata = {
  title: { absolute: "Terms & Conditions" },
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
