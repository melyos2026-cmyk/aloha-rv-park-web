import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Mely from "@/components/Mely";
import { Analytics } from "@vercel/analytics/react";

export const metadata: Metadata = {
  title: "Aloha RV Park – Kissimmee, Florida",
  description: "Your home away from home near Orlando, Disney World, Universal Studios & SeaWorld. 4648 S. Orange Blossom Trl, Kissimmee FL 34746",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
        <Mely />
        <Analytics />
      </body>
    </html>
  );
}
