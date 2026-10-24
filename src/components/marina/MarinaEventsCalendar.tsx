"use client";

import PdfCalendarViewer from "@/components/PdfCalendarViewer";

// Oct 24 (per Mely): the marina's monthly events calendar, shown BIG (full width, readable on a
// phone, tablet or computer) with Print and Download. Works with a PDF or an image (PNG/JPG),
// whatever the office uploads in Company Settings → Events Calendar.
const isPdf = (u: string) => /\.pdf($|\?)/i.test(u);

function printIt(url: string) {
  if (isPdf(url)) { window.open(url, "_blank", "noopener"); return; }   // the browser's PDF viewer prints it
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Events calendar</title>
    <style>@page{size:landscape;margin:10mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style>
    </head><body><img src="${url.replace(/"/g, "&quot;")}" onload="setTimeout(function(){window.print()},150)" alt="Events calendar"/></body></html>`);
  w.document.close();
}

export default function MarinaEventsCalendar({ url, title }: { url: string; title: string }) {
  return (
    <div className="mr-cal">
      <div className="mr-cal-frame">
        {isPdf(url) ? <PdfCalendarViewer pdfUrl={url} /> : <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} full size`}><img src={url} alt={title} /></a>}
      </div>
      <div className="mr-cal-actions">
        <button type="button" className="mr-btn dark" onClick={() => printIt(url)}>Print calendar</button>
        <a className="mr-btn mr-btn-outline" href={url} target="_blank" rel="noopener noreferrer" download>Download</a>
        <a className="mr-btn mr-btn-outline" href={url} target="_blank" rel="noopener noreferrer">Open full size</a>
      </div>
    </div>
  );
}
