import type { Metadata } from "next";

// Public page (no site password) — the carrier's A2P reviewer must be able
// to open it and see how people opt in to text messages.
export const metadata: Metadata = {
  title: { absolute: "Text Message Alerts — Sign Up" },
};

export default function TextMessagesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
