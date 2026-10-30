import ViewAsBanner from "@/components/ViewAsBanner";
import { ResidentSubPageFrame } from "@/components/ResidentPortalNav";

// Oct 29: this resident page lives outside /residents — show the read-only "View as resident"
// banner here too (it renders nothing outside that mode).
export default function ElectricHistoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ViewAsBanner />
      {/* Oct 30: portal sub-pages get the same side menu / tab bar as the dashboard */}
      <ResidentSubPageFrame>{children}</ResidentSubPageFrame>
    </>
  );
}
