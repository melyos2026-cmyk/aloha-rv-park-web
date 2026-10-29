import ViewAsBanner from "@/components/ViewAsBanner";

// Oct 29: this resident page lives outside /residents — show the read-only "View as resident"
// banner here too (it renders nothing outside that mode).
export default function ElectricHistoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ViewAsBanner />
      {children}
    </>
  );
}
