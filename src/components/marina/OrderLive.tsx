"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Oct 24 (per Mely): keeps the order page up to date (the store marks it ready / picked up)
// and empties the store cart once the order is placed.
export default function OrderLive({ active, clearCart }: { active: boolean; clearCart: boolean }) {
  const router = useRouter();
  useEffect(() => { if (clearCart) { try { localStorage.removeItem("mr_cart"); } catch {} } }, [clearCart]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20000);
    const onShow = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, [active, router]);
  return null;
}
