"use client";
export default function PrintButton() {
  return <button type="button" className="mr-btn dark" onClick={() => window.print()}>Download PDF / Print</button>;
}
