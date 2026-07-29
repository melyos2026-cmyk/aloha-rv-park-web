"use client";
import { useEffect, useRef, useState } from "react";

export default function PdfCalendarViewer({ pdfUrl }: { pdfUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setLoading(true);
      setError("");
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const containerWidth = containerRef.current.clientWidth || 800;
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2.5, (containerWidth / unscaledViewport.width) * 1.5);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.marginBottom = pageNum < pdf.numPages ? "16px" : "0";
          canvas.style.borderRadius = "6px";
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          containerRef.current.appendChild(canvas);
        }

        if (!cancelled) setLoading(false);
      } catch (err) {
        console.error("PDF render error:", err);
        if (!cancelled) {
          setError("Could not display the calendar here — use the download link below instead.");
          setLoading(false);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  return (
    <div>
      {loading && <p style={{ color: "var(--gray)", fontSize: 14, marginBottom: 12 }}>Loading calendar…</p>}
      {error && <p style={{ color: "var(--gray)", fontSize: 14, marginBottom: 12 }}>{error}</p>}
      <div ref={containerRef} style={{ maxWidth: 1000, margin: "0 auto" }} />
    </div>
  );
}
