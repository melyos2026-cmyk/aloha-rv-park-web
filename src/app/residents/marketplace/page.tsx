"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const CATEGORIES = ["Vehicles", "Property Rentals", "Apparel", "Classifieds", "Electronics", "Entertainment", "Family", "Free Stuff", "Garage Sale", "Garden & Outdoor", "Hobbies", "Home Goods", "Home Improvement", "Home Sales", "Musical Instruments", "Office Supplies", "Pet Supplies", "RV Parts", "Sporting Goods", "Toys & Games", "Other"];

type Listing = {
  id: string;
  resident_id: string;
  title: string;
  description: string | null;
  price: number | null;
  category: string;
  status: string;
  created_at: string;
  resident_accounts?: { full_name: string; rv_lots?: { lot_name: string } | null };
  marketplace_listing_photos?: { photo_url: string; sort_order: number }[];
};

const card = { background: "#fff", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", cursor: "pointer" as const };

export default function MarketplacePage() {
  const router = useRouter();
  const [residentId, setResidentId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [activePhoto, setActivePhoto] = useState(0);

  useEffect(() => {
    const id = localStorage.getItem("resident_id");
    if (!id) {
      router.push("/login");
      return;
    }
    setResidentId(id);
    load(id);
  }, []);

  async function load(residentIdParam: string) {
    setLoading(true);
    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("company_id")
      .eq("id", residentIdParam)
      .single();

    if (!resident) {
      setLoading(false);
      return;
    }
    setCompanyId(resident.company_id);

    const { data } = await supabase
      .from("marketplace_listings")
      .select("*, resident_accounts(full_name, rv_lots(lot_name)), marketplace_listing_photos(photo_url, sort_order)")
      .eq("company_id", resident.company_id)
      .neq("status", "removed")
      .order("created_at", { ascending: false });

    setListings(data || []);
    setLoading(false);
  }

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setPrice("");
    setCategory(CATEGORIES[0]);
    setPhotoFiles([]);
    setShowForm(false);
  }

  function startEdit(listing: Listing) {
    setEditingId(listing.id);
    setTitle(listing.title);
    setDescription(listing.description || "");
    setPrice(listing.price != null ? String(listing.price) : "");
    setCategory(listing.category || CATEGORIES[0]);
    setPhotoFiles([]);
    setShowForm(true);
  }

  async function saveListing() {
    if (!title.trim() || !residentId || !companyId) {
      alert("Please enter a title.");
      return;
    }
    setSaving(true);

    let listingId = editingId;

    if (editingId) {
      await supabase
        .from("marketplace_listings")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          price: price ? Number(price) : null,
          category,
        })
        .eq("id", editingId);
    } else {
      const { data: newListing, error } = await supabase
        .from("marketplace_listings")
        .insert({
          company_id: companyId,
          resident_id: residentId,
          title: title.trim(),
          description: description.trim() || null,
          price: price ? Number(price) : null,
          category,
          status: "active",
        })
        .select("id")
        .single();

      if (error || !newListing) {
        alert("Could not create listing: " + (error?.message || ""));
        setSaving(false);
        return;
      }
      listingId = newListing.id;
    }

    if (listingId && photoFiles.length > 0) {
      for (let i = 0; i < photoFiles.length; i++) {
        const file = photoFiles[i];
        const path = `marketplace/${listingId}/${Date.now()}-${i}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("company-assets").upload(path, file);
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("company-assets").getPublicUrl(path);
          await supabase.from("marketplace_listing_photos").insert({
            listing_id: listingId,
            photo_url: urlData.publicUrl,
            sort_order: i,
          });
        }
      }
    }

    resetForm();
    if (residentId) load(residentId);
  }

  async function markSold(listingId: string) {
    await supabase.from("marketplace_listings").update({ status: "sold" }).eq("id", listingId);
    setSelectedListing(null);
    if (residentId) load(residentId);
  }

  async function deleteListing(listingId: string) {
    if (!confirm("Delete this listing?")) return;
    await supabase.from("marketplace_listings").delete().eq("id", listingId);
    setSelectedListing(null);
    if (residentId) load(residentId);
  }

  const visibleListings = listings
    .filter((l) => (tab === "mine" ? l.resident_id === residentId : l.status === "active"))
    .filter((l) => categoryFilter === "All" || l.category === categoryFilter)
    .filter((l) => !search.trim() || l.title.toLowerCase().includes(search.trim().toLowerCase()));

  if (selectedListing) {
    const photos = (selectedListing.marketplace_listing_photos || []).sort((a, b) => a.sort_order - b.sort_order);
    const isMine = selectedListing.resident_id === residentId;
    return (
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "40px 24px" }}>
        <button onClick={() => setSelectedListing(null)} style={{ background: "none", border: "none", fontSize: 14, color: "var(--gray)", cursor: "pointer", marginBottom: 20 }}>
          ← Back to Marketplace
        </button>

        {photos.length > 0 ? (
          <div style={{ marginBottom: 20 }}>
            <div style={{ width: "100%", aspectRatio: "4 / 3", borderRadius: 8, overflow: "hidden", background: "var(--gray-light)" }}>
              <img
                src={photos[Math.min(activePhoto, photos.length - 1)].photo_url}
                alt={selectedListing.title}
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

        <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 4 }}>{selectedListing.title}</h1>
        <p style={{ fontSize: 24, fontWeight: 900, color: "var(--red)", marginBottom: 12 }}>
          {selectedListing.price != null ? `$${Number(selectedListing.price).toLocaleString()}` : "Free / Make an offer"}
        </p>
        {selectedListing.status === "sold" && (
          <span style={{ display: "inline-block", background: "#f3f4f6", color: "#6b7280", fontWeight: 700, fontSize: 12, padding: "4px 12px", borderRadius: 999, marginBottom: 12 }}>SOLD</span>
        )}
        <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 4 }}>Category: {selectedListing.category}</p>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{selectedListing.description}</p>

        <div style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 2 }}>Seller</p>
          <p style={{ fontWeight: 700 }}>
            {selectedListing.resident_accounts?.full_name}
            {selectedListing.resident_accounts?.rv_lots?.lot_name && ` — Lot ${selectedListing.resident_accounts.rv_lots.lot_name}`}
          </p>
          <p style={{ fontSize: 13, color: "var(--gray)", marginTop: 6 }}>Contact them in person at the park, or through the office.</p>
        </div>

        {isMine && (
          <div style={{ display: "flex", gap: 12 }}>
            {selectedListing.status === "active" && (
              <button onClick={() => markSold(selectedListing.id)} style={{ background: "#16a34a", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
                Mark as Sold
              </button>
            )}
            <button onClick={() => { startEdit(selectedListing); setSelectedListing(null); }} style={{ background: "#000", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
              Edit
            </button>
            <button onClick={() => deleteListing(selectedListing.id)} style={{ background: "none", border: "1.5px solid #dc2626", color: "#dc2626", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
              Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
      <button onClick={() => router.push("/residents/dashboard")} style={{ background: "none", border: "none", fontSize: 14, color: "var(--gray)", cursor: "pointer", marginBottom: 20 }}>
        ← Back to Dashboard
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900 }}>🛍️ Marketplace</h1>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          style={{ background: "var(--red)", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
        >
          + Post a Listing
        </button>
      </div>

      {showForm && (
        <div style={{ border: "2px solid var(--black)", borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{editingId ? "Edit Listing" : "New Listing"}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input placeholder="Title (e.g. Patio Chairs, Bike Rack...)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
            <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input type="number" placeholder="Price ($, leave blank for free/OBO)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--gray)", display: "block", marginBottom: 6 }}>
                Photos (up to 10)
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 10) {
                    alert("You can upload up to 10 photos. Only the first 10 will be used.");
                  }
                  setPhotoFiles(files.slice(0, 10));
                }}
              />
              {photoFiles.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 10 }}>
                  {photoFiles.map((file, i) => (
                    <div key={i} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`Preview ${i + 1}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                      <button
                        type="button"
                        onClick={() => setPhotoFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, fontSize: 12, lineHeight: 1, cursor: "pointer" }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={saveListing} disabled={saving} style={{ background: "#000", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving..." : editingId ? "Update Listing" : "Post Listing"}
            </button>
            <button onClick={resetForm} style={{ background: "none", border: "none", color: "var(--gray)", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 20, marginBottom: 16, borderBottom: "1.5px solid var(--border)" }}>
        <button onClick={() => setTab("browse")} style={{ background: "none", border: "none", padding: "10px 0", fontWeight: 700, borderBottom: tab === "browse" ? "2px solid var(--red)" : "none", color: tab === "browse" ? "var(--black)" : "var(--gray)", cursor: "pointer" }}>Browse</button>
        <button onClick={() => setTab("mine")} style={{ background: "none", border: "none", padding: "10px 0", fontWeight: 700, borderBottom: tab === "mine" ? "2px solid var(--red)" : "none", color: tab === "mine" ? "var(--black)" : "var(--gray)", cursor: "pointer" }}>My Listings</button>
      </div>

      {tab === "browse" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <input placeholder="Search listings..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, flex: 1, minWidth: 180 }} />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }}>
            <option value="All">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--gray)" }}>Loading...</p>
      ) : visibleListings.length === 0 ? (
        <p style={{ color: "var(--gray)" }}>{tab === "mine" ? "You haven't posted anything yet." : "No listings yet."}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {visibleListings.map((l) => {
            const cover = (l.marketplace_listing_photos || []).sort((a, b) => a.sort_order - b.sort_order)[0];
            return (
              <div key={l.id} style={card} onClick={() => { setSelectedListing(l); setActivePhoto(0); }}>
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
                  {l.status === "sold" && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>SOLD</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
