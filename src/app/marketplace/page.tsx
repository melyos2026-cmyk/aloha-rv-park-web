"use client";

import { useEffect, useState } from "react";
import { useCompany } from "@/lib/CompanyContext";
import { supabase } from "@/lib/supabase";

const CATEGORIES = ["Vehicles", "Womenswear", "Menswear", "Kidswear & Baby", "Antiques", "Books", "Movies & Music", "Classifieds", "Electronics", "Entertainment", "Free Stuff", "Garage Sale", "Patio & Garden", "Health & Beauty", "Hobbies", "Home & Kitchen", "Home Improvement", "Home Sales", "Jewelry & Watches", "Luggage & Bags", "Musical Instruments", "Office Supplies", "Pet Supplies", "RV Parts", "Sporting Goods", "Toys & Games", "Miscellaneous"];

type Listing = {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  category: string;
  status: string;
  resident_accounts?: { full_name: string; rv_lots?: { lot_name: string } | null };
  marketplace_listing_photos?: { photo_url: string; sort_order: number }[];
};

const card = { background: "#fff", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", cursor: "pointer" as const };

export default function PublicMarketplacePage() {
  const { company } = useCompany();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Listing | null>(null);
  const [activePhoto, setActivePhoto] = useState(0);

  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!company?.id) return;
    supabase
      .from("marketplace_listings")
      .select("*, resident_accounts(full_name, rv_lots(lot_name)), marketplace_listing_photos(photo_url, sort_order)")
      .eq("company_id", company.id)
      .eq("status", "active")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setListings(data || []);
        setLoading(false);
      });
  }, [company?.id]);

  async function sendInquiry() {
    if (!selected || !buyerName.trim() || !buyerEmail.trim() || !message.trim()) {
      setError("Please fill in your name, email, and a message.");
      return;
    }
    setSending(true);
    setError("");
    const res = await fetch("/api/marketplace-contact-seller", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: selected.id,
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim(),
        buyerPhone: buyerPhone.trim(),
        message: message.trim(),
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      setError(result.error || "Could not send your message.");
      setSending(false);
      return;
    }
    setSent(true);
    setSending(false);
  }

  const visibleListings = listings
    .filter((l) => categoryFilter === "All" || l.category === categoryFilter)
    .filter((l) => !search.trim() || l.title.toLowerCase().includes(search.trim().toLowerCase()));

  if (selected) {
    const photos = (selected.marketplace_listing_photos || []).sort((a, b) => a.sort_order - b.sort_order);
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "40px 24px" }}>
        <button onClick={() => { setSelected(null); setSent(false); setError(""); }} style={{ background: "none", border: "none", fontSize: 14, color: "var(--gray)", cursor: "pointer", marginBottom: 20 }}>
          ← Back to Marketplace
        </button>

        {photos.length > 0 ? (
          <div style={{ marginBottom: 20 }}>
            <div style={{ width: "100%", aspectRatio: "4 / 3", borderRadius: 8, overflow: "hidden", background: "var(--gray-light)" }}>
              <img
                src={photos[Math.min(activePhoto, photos.length - 1)].photo_url}
                alt={selected.title}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
            {photos.length > 1 && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto" }}>
                {photos.map((p, i) => (
                  <div
                    key={i}
                    onClick={() => setActivePhoto(i)}
                    style={{
                      width: 64,
                      height: 64,
                      flexShrink: 0,
                      borderRadius: 6,
                      overflow: "hidden",
                      cursor: "pointer",
                      border: i === activePhoto ? "2px solid var(--red)" : "2px solid transparent",
                    }}
                  >
                    <img src={p.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ height: 200, background: "var(--gray-light)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gray)", marginBottom: 20 }}>
            No photos
          </div>
        )}

        <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 4 }}>{selected.title}</h1>
        <p style={{ fontSize: 24, fontWeight: 900, color: "var(--red)", marginBottom: 12 }}>
          {selected.price != null ? `$${Number(selected.price).toLocaleString()}` : "Free / Make an offer"}
        </p>
        <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 4 }}>Category: {selected.category}</p>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{selected.description}</p>

        <div style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 2 }}>Seller</p>
          <p style={{ fontWeight: 700 }}>
            {selected.resident_accounts?.full_name}
            {selected.resident_accounts?.rv_lots?.lot_name && ` — Lot ${selected.resident_accounts.rv_lots.lot_name}`}
          </p>
        </div>

        {sent ? (
          <div style={{ background: "#f0fdf4", border: "1.5px solid #16a34a", borderRadius: 8, padding: 16 }}>
            <p style={{ fontWeight: 700, color: "#166534" }}>✅ Message sent!</p>
            <p style={{ fontSize: 13, color: "#166534" }}>The seller will reach out to you directly.</p>
          </div>
        ) : (
          <div style={{ border: "2px solid var(--black)", borderRadius: 8, padding: 20 }}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 12 }}>Contact Seller</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input placeholder="Your name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <input type="email" placeholder="Your email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <input placeholder="Your phone (optional)" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <textarea placeholder="Message (e.g. 'Is this still available?')" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
            </div>
            {error && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{error}</p>}
            <button
              onClick={sendInquiry}
              disabled={sending}
              style={{ marginTop: 14, background: "var(--red)", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: sending ? "default" : "pointer", opacity: sending ? 0.7 : 1 }}
            >
              {sending ? "Sending..." : "Send Message"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontFamily: "Playfair Display, serif", fontSize: 32, fontWeight: 900, marginBottom: 8 }}>🛍️ Marketplace</h1>
      <p style={{ color: "var(--gray)", marginBottom: 24, fontSize: 14 }}>
        Items for sale by residents of {company?.company_name || "our park"}. Only residents can post — anyone can browse and reach out.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input placeholder="Search listings..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, flex: 1, minWidth: 180 }} />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }}>
          <option value="All">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <p style={{ color: "var(--gray)" }}>Loading...</p>
      ) : visibleListings.length === 0 ? (
        <p style={{ color: "var(--gray)" }}>No listings yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {visibleListings.map((l) => {
            const cover = (l.marketplace_listing_photos || []).sort((a, b) => a.sort_order - b.sort_order)[0];
            return (
              <div key={l.id} style={card} onClick={() => { setSelected(l); setActivePhoto(0); }}>
                {cover ? (
                  <img src={cover.photo_url} alt={l.title} style={{ width: "100%", height: 150, objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: 150, background: "var(--gray-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gray)", fontSize: 12 }}>
                    No photo
                  </div>
                )}
                <div style={{ padding: 10 }}>
                  <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{l.title}</p>
                  <p style={{ fontWeight: 900, fontSize: 15, color: "var(--red)" }}>
                    {l.price != null ? `$${Number(l.price).toLocaleString()}` : "Free / OBO"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
