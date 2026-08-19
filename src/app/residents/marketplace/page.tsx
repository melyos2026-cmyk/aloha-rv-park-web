"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useCompany } from "@/lib/CompanyContext";

const CATEGORIES = ["Vehicles", "Womenswear", "Menswear", "Kidswear & Baby", "Antiques", "Books", "Movies & Music", "Classifieds", "Electronics", "Entertainment", "Free Stuff", "Garage Sale", "Patio & Garden", "Health & Beauty", "Hobbies", "Home & Kitchen", "Home Improvement", "Home Sales", "Jewelry & Watches", "Luggage & Bags", "Musical Instruments", "Office Supplies", "Pet Supplies", "RV Parts", "Sporting Goods", "Toys & Games", "Miscellaneous", "Other"];

type Listing = {
  id: string;
  resident_id: string;
  title: string;
  description: string | null;
  price: number | null;
  category: string;
  status: string;
  created_at: string;
  expires_at?: string | null;
  posted_by_admin?: boolean;
  resident_accounts?: { full_name: string; rv_lots?: { lot_name: string } | null };
  marketplace_listing_photos?: { photo_url: string; sort_order: number }[];
};

const card = { background: "#fff", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", cursor: "pointer" as const };

export default function MarketplacePage() {
  const router = useRouter();
  const { company } = useCompany();
  const [residentId, setResidentId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"browse" | "mine" | "saved">("browse");
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
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  const [shareConfirm, setShareConfirm] = useState<string | null>(null);

  function shareListing(e: React.MouseEvent, listingId: string) {
    e.stopPropagation();
    const url = `${window.location.origin}/marketplace?listing=${listingId}`;
    if (navigator.share) {
      navigator.share({ url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url);
      setShareConfirm(listingId);
      setTimeout(() => setShareConfirm(null), 2000);
    }
  }

  useEffect(() => {
    const id = localStorage.getItem("resident_id");
    if (!id) {
      router.push("/login");
      return;
    }
    setResidentId(id);
    setLastVisit(localStorage.getItem(`marketplace_last_visit_${id}`));
    load(id);
    localStorage.setItem(`marketplace_last_visit_${id}`, new Date().toISOString());
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

    const res = await fetch(
      `/api/portal/marketplace-listings?residentId=${residentIdParam}&companyId=${resident.company_id}`
    );
    const result = await res.json();
    if (!res.ok) {
      setLoading(false);
      return;
    }
    setListings(result.listings || []);
    setSavedIds(result.savedIds || []);

    setLoading(false);
  }

  async function toggleSaved(listingId: string) {
    if (!residentId) return;
    const nowSaved = !savedIds.includes(listingId);
    // Optimistic UI update, reverted below if the request fails.
    if (nowSaved) {
      setSavedIds((prev) => [...prev, listingId]);
    } else {
      setSavedIds((prev) => prev.filter((id) => id !== listingId));
    }
    const res = await fetch("/api/portal/marketplace-toggle-saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, listingId, saved: nowSaved }),
    });
    if (!res.ok) {
      // Revert on failure.
      if (nowSaved) {
        setSavedIds((prev) => prev.filter((id) => id !== listingId));
      } else {
        setSavedIds((prev) => [...prev, listingId]);
      }
    }
  }

  async function repostListing(listingId: string) {
    if (!residentId) return;
    await fetch("/api/portal/marketplace-repost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, listingId }),
    });
    setSelectedListing(null);
    load(residentId);
  }

  function daysLeft(expiresAt?: string | null) {
    if (!expiresAt) return null;
    const diff = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
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

    const res = await fetch("/api/portal/marketplace-save-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        residentId,
        listingId: editingId,
        title,
        description,
        price,
        category,
      }),
    });
    const result = await res.json();

    if (!res.ok) {
      alert("Could not save listing: " + (result.error || ""));
      setSaving(false);
      return;
    }

    const listingId = result.listingId;

    if (listingId && photoFiles.length > 0) {
      for (let i = 0; i < photoFiles.length; i++) {
        const file = photoFiles[i];
        const path = `marketplace/${listingId}/${Date.now()}-${i}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("company-assets").upload(path, file);
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("company-assets").getPublicUrl(path);
          await fetch("/api/portal/marketplace-add-photo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              residentId,
              listingId,
              photoUrl: urlData.publicUrl,
              sortOrder: i,
            }),
          });
        }
      }
    }

    resetForm();
    if (residentId) load(residentId);
  }

  async function markSold(listingId: string) {
    if (!residentId) return;
    await fetch("/api/portal/marketplace-mark-sold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, listingId }),
    });
    setSelectedListing(null);
    load(residentId);
  }

  async function deleteListing(listingId: string) {
    if (!confirm("Delete this listing?")) return;
    if (!residentId) return;
    await fetch("/api/portal/marketplace-delete-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, listingId }),
    });
    setSelectedListing(null);
    load(residentId);
  }

  const visibleListings = listings
    .filter((l) => {
      if (tab === "mine") return l.resident_id === residentId;
      const notExpired = !l.expires_at || daysLeft(l.expires_at)! > 0;
      if (tab === "saved") return savedIds.includes(l.id) && notExpired;
      return l.status === "active" && notExpired;
    })
    .filter((l) => categoryFilter === "All" || l.category === categoryFilter)
    .filter((l) => !search.trim() || l.title.toLowerCase().includes(search.trim().toLowerCase()));

  const newForYou = lastVisit
    ? listings.filter(
        (l) => l.resident_id !== residentId && l.status === "active" && new Date(l.created_at) > new Date(lastVisit)
      )
    : [];

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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 4 }}>{selectedListing.title}</h1>
          <button
            onClick={(e) => shareListing(e, selectedListing.id)}
            style={{ background: "#fff", border: "1.5px solid var(--border)", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {shareConfirm === selectedListing.id ? "✅ Copied" : "🔗 Share"}
          </button>
        </div>
        <p style={{ fontSize: 24, fontWeight: 900, color: "var(--red)", marginBottom: 12 }}>
          {selectedListing.price != null ? `$${Number(selectedListing.price).toLocaleString()}` : "Free / Make an offer"}
        </p>
        {selectedListing.status === "sold" && (
          <span style={{ display: "inline-block", background: "#f3f4f6", color: "#6b7280", fontWeight: 700, fontSize: 12, padding: "4px 12px", borderRadius: 999, marginBottom: 12 }}>SOLD</span>
        )}
        <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 4 }}>Category: {selectedListing.category}</p>
        {isMine && selectedListing.expires_at && (
          <p style={{ fontSize: 13, color: (daysLeft(selectedListing.expires_at) ?? 0) <= 5 ? "#dc2626" : "var(--gray)", marginBottom: 4 }}>
            {(daysLeft(selectedListing.expires_at) ?? 0) > 0
              ? `Expires in ${daysLeft(selectedListing.expires_at)} day${daysLeft(selectedListing.expires_at) === 1 ? "" : "s"} — repost to keep it active`
              : "This listing has expired"}
          </p>
        )}
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{selectedListing.description}</p>

        <div style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 2 }}>Seller</p>
          <p style={{ fontWeight: 700 }}>
            {selectedListing.posted_by_admin
              ? `Posted by ${company?.company_name || "the park"}`
              : (
                <>
                  {selectedListing.resident_accounts?.full_name}
                  {selectedListing.resident_accounts?.rv_lots?.lot_name && ` — Lot ${selectedListing.resident_accounts.rv_lots.lot_name}`}
                </>
              )}
          </p>
          <p style={{ fontSize: 13, color: "var(--gray)", marginTop: 6 }}>
            {selectedListing.posted_by_admin
              ? "Contact the office for details."
              : "Contact them in person at the park, or through the office."}
          </p>
        </div>

        {!isMine && (
          <button
            onClick={() => toggleSaved(selectedListing.id)}
            style={{ background: "none", border: "1.5px solid var(--border)", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}
          >
            {savedIds.includes(selectedListing.id) ? "❤️ Saved" : "🤍 Save"}
          </button>
        )}

        {isMine && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {selectedListing.status === "active" && (
              <button onClick={() => markSold(selectedListing.id)} style={{ background: "var(--black)", color: "#fff", border: "1.5px solid var(--black)", padding: "10px 20px", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Mark as Sold
              </button>
            )}
            <button onClick={() => repostListing(selectedListing.id)} style={{ background: "#fff", color: "var(--black)", border: "1.5px solid var(--black)", padding: "10px 20px", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              🔁 Repost
            </button>
            <button onClick={() => { startEdit(selectedListing); setSelectedListing(null); }} style={{ background: "#fff", color: "var(--black)", border: "1.5px solid var(--black)", padding: "10px 20px", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Edit
            </button>
            <button onClick={() => deleteListing(selectedListing.id)} style={{ background: "none", border: "1.5px solid var(--border)", color: "var(--gray)", padding: "10px 20px", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderListingCard(l: Listing) {
    const cover = (l.marketplace_listing_photos || []).sort((a, b) => a.sort_order - b.sort_order)[0];
    const mine = l.resident_id === residentId;
    const left = daysLeft(l.expires_at);
    return (
      <div key={l.id} style={{ ...card, position: "relative" }} onClick={() => { setSelectedListing(l); setActivePhoto(0); }}>
        <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6, zIndex: 1 }}>
          <button
            onClick={(e) => shareListing(e, l.id)}
            style={{ background: "rgba(255,255,255,0.9)", border: "none", borderRadius: "50%", width: 28, height: 28, fontSize: 13, cursor: "pointer" }}
            title="Share"
          >
            {shareConfirm === l.id ? "✅" : "🔗"}
          </button>
          {!mine && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleSaved(l.id); }}
              style={{ background: "rgba(255,255,255,0.9)", border: "none", borderRadius: "50%", width: 28, height: 28, fontSize: 14, cursor: "pointer" }}
            >
              {savedIds.includes(l.id) ? "❤️" : "🤍"}
            </button>
          )}
        </div>
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
          {mine && tab === "mine" && left != null && (
            <p style={{ fontSize: 11, color: left <= 5 ? "#dc2626" : "var(--gray)", marginTop: 2 }}>
              {left > 0 ? `Expires in ${left}d` : "Expired"}
            </p>
          )}
        </div>
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
        <button onClick={() => setTab("saved")} style={{ background: "none", border: "none", padding: "10px 0", fontWeight: 700, borderBottom: tab === "saved" ? "2px solid var(--red)" : "none", color: tab === "saved" ? "var(--black)" : "var(--gray)", cursor: "pointer" }}>Saved</button>
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

      {tab === "browse" && newForYou.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>🆕 New For You</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {newForYou.map((l) => renderListingCard(l))}
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--gray)" }}>Loading...</p>
      ) : visibleListings.length === 0 ? (
        <p style={{ color: "var(--gray)" }}>{tab === "mine" ? "You haven't posted anything yet." : "No listings yet."}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {visibleListings.map((l) => renderListingCard(l))}
        </div>
      )}
    </div>
  );
}
