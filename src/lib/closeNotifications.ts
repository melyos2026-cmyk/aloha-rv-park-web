// Oct 9 (per Mely): when the user has already seen something inside the app,
// the matching alert in the phone/computer's notification tray should go away
// too (like WhatsApp). Push alerts are tagged "n-<notification id>" (or "p-…").
export async function closeSeenNotifications(unreadIds: Set<string>, closeAll = false) {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const shown = await reg.getNotifications();
      for (const n of shown) {
        const tag = n.tag || "";
        const m = tag.match(/^[np]-(.+)$/);
        if (closeAll || tag === "welcome" || (m && !unreadIds.has(m[1]))) n.close();
      }
    }
  } catch {}
}
