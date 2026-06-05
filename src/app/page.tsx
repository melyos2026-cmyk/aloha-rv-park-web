"use client";
import Link from "next/link";

export default function Home() {
  return (
    <>
      {/* Hero Banner */}
      <section style={{
        background: "var(--black)",
        color: "var(--white)",
        padding: "80px 24px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden"
      }}>
        <div style={{
          position: "absolute", inset: 0,
          background: "repeating-linear-gradient(45deg, transparent, transparent 40px, rgba(220,38,38,0.03) 40px, rgba(220,38,38,0.03) 80px)"
        }} />
        <div style={{ position: "relative", maxWidth: 800, margin: "0 auto" }}>
          <div style={{ fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 16 }}>
            ★ Kissimmee, Florida ★
          </div>
          <h1 style={{ fontSize: "clamp(40px, 7vw, 80px)", fontWeight: 900, lineHeight: 1.05, marginBottom: 24 }}>
            Your Home<br />Away From Home
          </h1>
          <p style={{ fontSize: 18, color: "#9ca3af", lineHeight: 1.7, marginBottom: 40, maxWidth: 560, margin: "0 auto 40px" }}>
            Located minutes from Disney World, Universal Studios & SeaWorld. 
            Daily, weekly & monthly rates available.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="#map" style={{
              background: "var(--red)", color: "var(--white)",
              padding: "16px 32px", borderRadius: 4, fontWeight: 700,
              fontSize: 15, letterSpacing: "0.05em", textTransform: "uppercase"
            }}>
              View Lot Map
            </a>
            <Link href="/apply" style={{
              background: "transparent", color: "var(--white)",
              padding: "16px 32px", borderRadius: 4, fontWeight: 700,
              fontSize: 15, letterSpacing: "0.05em", textTransform: "uppercase",
              border: "2px solid var(--white)"
            }}>
              Apply Now
            </Link>
          </div>
        </div>
      </section>

      {/* Rates Bar */}
      <section style={{ background: "var(--red)", color: "var(--white)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "center", gap: "clamp(24px, 5vw, 80px)", flexWrap: "wrap" }}>
          {[["Daily","$40/night"],["Weekly","$225/week"],["Monthly (Peak)","$750/mo"],["Monthly (Off-Peak)","$600/mo"]].map(([l,v]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", opacity: 0.8 }}>{l}</div>
              <div style={{ fontSize: 22, fontFamily: "Playfair Display, serif", fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Amenities */}
      <section style={{ padding: "80px 24px", background: "var(--cream)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>What We Offer</div>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 900 }}>Park Amenities</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 24 }}>
            {[
              ["🏊","Pool"],["⛹️","Shuffleboard"],["🔥","Fire Pit"],
              ["⛽","Propane Station"],["🚐","RV Storage"],["🚿","Restrooms & Showers"],
              ["👕","Laundry 24/7"],["📶","WiFi"],["⚡","50/100 Amps (1,000 kWh incl.)"],
              ["💧","Water & Sewer Included"],["🐾","Pet Area"],["🎉","Rec Hall"]
            ].map(([icon, label]) => (
              <div key={label} style={{
                background: "var(--white)", border: "1.5px solid var(--border)",
                borderRadius: 8, padding: "24px 16px", textAlign: "center",
                transition: "border-color 0.2s, transform 0.2s"
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--red)"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; }}
              >
                <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.03em" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Map Section */}
      <section id="map" style={{ padding: "80px 24px", background: "var(--white)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>Available Now</div>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 900 }}>Lot Map</h2>
            <p style={{ fontSize: 15, color: "var(--gray)", marginTop: 12 }}>Click any green lot to book your spot</p>
          </div>
          <div style={{ border: "2px solid var(--black)", borderRadius: 8, overflow: "hidden" }}>
            <iframe
              src="https://aloha-rv-park.vercel.app"
              style={{ width: "100%", height: 700, border: "none" }}
              title="Aloha RV Park Lot Map"
            />
          </div>
        </div>
      </section>

      {/* Location */}
      <section style={{ padding: "80px 24px", background: "var(--cream)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 48, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>Find Us</div>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 900, marginBottom: 24 }}>Near Orlando's Best Attractions</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[["🏰","Disney World","~15 min"],["🎬","Universal Studios","~20 min"],["🦈","SeaWorld","~15 min"],["🛍️","Florida Mall","~10 min"]].map(([icon,place,time]) => (
                <div key={place} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ fontSize: 24, width: 40, textAlign: "center" }}>{icon}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{place}</div>
                    <div style={{ fontSize: 13, color: "var(--gray)" }}>{time}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 32 }}>
              <a href="https://maps.google.com/?q=4648+S+Orange+Blossom+Trl+Kissimmee+FL" target="_blank" rel="noreferrer"
                style={{ background: "var(--black)", color: "var(--white)", padding: "14px 28px", borderRadius: 4, fontWeight: 700, fontSize: 14, display: "inline-block" }}>
                📍 Get Directions
              </a>
            </div>
          </div>
          <div style={{ background: "var(--black)", borderRadius: 8, overflow: "hidden", aspectRatio: "4/3" }}>
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3509.6!2d-81.4!3d28.3!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2s4648+S+Orange+Blossom+Trl+Kissimmee+FL!5e0!3m2!1sen!2sus!4v1"
              width="100%" height="100%" style={{ border: 0 }} loading="lazy"
              title="Aloha RV Park Location"
            />
          </div>
        </div>
      </section>
    </>
  );
}
// rebuild Fri Jun  5 18:57:09 EDT 2026
