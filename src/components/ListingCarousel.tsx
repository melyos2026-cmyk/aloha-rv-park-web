"use client";
import { useState } from "react";

export default function ListingCarousel({
  images,
  height = 200,
}: {
  images: string[];
  height?: number;
}) {
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div style={{ height, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 }}>
        🏠
      </div>
    );
  }

  function go(delta: number, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setIndex((prev) => (prev + delta + images.length) % images.length);
  }

  return (
    <div style={{ position: "relative", height, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          background: `url(${images[index]}) center/cover`,
          transition: "background-image 0.15s ease-in-out",
        }}
      />

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => go(-1, e)}
            aria-label="Previous photo"
            style={{
              position: "absolute", top: "50%", left: 8, transform: "translateY(-50%)",
              width: 28, height: 28, borderRadius: "50%", border: "none",
              background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: 14,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => go(1, e)}
            aria-label="Next photo"
            style={{
              position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)",
              width: 28, height: 28, borderRadius: "50%", border: "none",
              background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: 14,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ›
          </button>

          <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 }}>
            {images.map((_, i) => (
              <span
                key={i}
                style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: i === index ? "#fff" : "rgba(255,255,255,0.5)",
                  boxShadow: "0 0 2px rgba(0,0,0,0.5)",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
