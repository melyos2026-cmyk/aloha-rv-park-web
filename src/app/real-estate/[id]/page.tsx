"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useCompany } from "@/lib/CompanyContext";
import ListingCarousel from "@/components/ListingCarousel";
import InquiryModal from "@/components/InquiryModal";

type ListingDetail = {
  id: string;
  lot_key: string | null;
  type: string;
  category: string;
  title: string;
  price: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  description: string | null;
  image_url: string | null;
  image_urls: string[] | null;
  address: string | null;
  year_built: number | null;
  lot_rent_info: string | null;
  parking_info: string | null;
  sold: boolean;
};

const typeLabels: Record<string, string> = {
  rent: "For Rent",
  sale: "For Sale",
  "rent-to-own": "Rent-to-Own",
};

const typeColors: Record<string, string> = {
  rent: "#16a34a",
  sale: "var(--red)",
  "rent-to-own": "#b45309",
};

export default function ListingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { company, loading: companyLoading } = useCompany();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showInquiry, setShowInquiry] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (companyLoading || !company?.park_id || !id) return;

    async function loadListing() {
      const { data, error } = await supabase
        .from("real_estate_listings")
        .select("id, lot_key, type, category, title, price, beds, baths, sqft, description, image_url, image_urls, address, year_built, lot_rent_info, parking_info, sold")
        .eq("id", id)
        .eq("park_id", company!.park_id)
        .eq("available", true)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
      } else {
        setListing(data as ListingDetail);
      }
      setLoading(false);
    }
    loadListing();
  }, [id, company, companyLoading]);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: listing?.title, url });
      } catch {
        // user cancelled the share sheet — nothing to do
      }
    } else {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }

  if (loading || companyLoading) {
    return (
      <section style={{ padding: "80px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--gray)" }}>Loading listing...</p>
      </section>
    );
  }

  if (notFound || !listing) {
    return (
      <section style={{ padding: "80px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--gray)", marginBottom: 20 }}>This listing is no longer available.</p>
        <Link href="/real-estate" style={{ color: "var(--red)", fontWeight: 700 }}>← Back to Real Estate</Link>
      </section>
    );
  }

  const images = listing.image_urls && listing.image_urls.length > 0 ? listing.image_urls : (listing.image_url ? [listing.image_url] : []);

  return (
    <section style={{ padding: "40px 24px 80px", background: "var(--cream)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <button onClick={() => router.push("/real-estate")} style={{ background: "none", border: "none", color: "var(--gray)", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 16, padding: 0 }}>
          ← Back to Real Estate
        </button>

        <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "2px solid var(--black)", marginBottom: 24 }}>
          <ListingCarousel images={images} height={420} />
          <div style={{ position: "absolute", top: 16, left: 16, background: listing.sold ? "#374151" : (typeColors[listing.type] || "#374151"), color: "var(--white)", padding: "6px 14px", borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", pointerEvents: "none" }}>
            {listing.sold ? "Sold" : (typeLabels[listing.type] || listing.type)}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--gray)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{listing.category}</div>
        <h1 style={{ fontSize: 32, fontWeight: 900, marginBottom: 8 }}>{listing.title}</h1>
        {listing.address && (
          <p style={{ fontSize: 14, color: "var(--gray)", marginBottom: 12 }}>📍 {listing.address}</p>
        )}
        <div style={{ fontSize: 30, fontFamily: "Playfair Display, serif", fontWeight: 700, color: typeColors[listing.type] || "#374151", marginBottom: 20 }}>
          {listing.price}
        </div>

        {/* Key facts grid — matches the Realtor.com-style layout Mely referenced */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 24, marginBottom: 24 }}>
          {listing.beds != null && (
            <div><div style={{ fontSize: 12, color: "var(--gray)" }}>Bedrooms</div><div style={{ fontSize: 16, fontWeight: 700 }}>🛏 {listing.beds}</div></div>
          )}
          {listing.baths != null && (
            <div><div style={{ fontSize: 12, color: "var(--gray)" }}>Bathrooms</div><div style={{ fontSize: 16, fontWeight: 700 }}>🚿 {listing.baths}</div></div>
          )}
          {listing.sqft != null && (
            <div><div style={{ fontSize: 12, color: "var(--gray)" }}>Square Feet</div><div style={{ fontSize: 16, fontWeight: 700 }}>📐 {listing.sqft} sqft</div></div>
          )}
          <div><div style={{ fontSize: 12, color: "var(--gray)" }}>Property Type</div><div style={{ fontSize: 16, fontWeight: 700 }}>🏠 {listing.category}</div></div>
          {listing.year_built != null && (
            <div><div style={{ fontSize: 12, color: "var(--gray)" }}>Year Built</div><div style={{ fontSize: 16, fontWeight: 700 }}>{listing.year_built}</div></div>
          )}
          {listing.parking_info && (
            <div><div style={{ fontSize: 12, color: "var(--gray)" }}>Parking</div><div style={{ fontSize: 16, fontWeight: 700 }}>{listing.parking_info}</div></div>
          )}
        </div>

        {listing.lot_rent_info && (
          <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 8, padding: "14px 18px", marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Lot Rent (Month-to-Month)</div>
            <p style={{ fontSize: 14, color: "#92400e", margin: 0 }}>{listing.lot_rent_info}</p>
          </div>
        )}

        {listing.description && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Description</h2>
            <p style={{ fontSize: 15, color: "var(--gray)", lineHeight: 1.7 }}>{listing.description}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          {listing.sold ? (
            <div style={{
              flex: 1, textAlign: "center",
              background: "#f3f4f6", color: "#6b7280",
              padding: "14px", borderRadius: 6, fontWeight: 700, fontSize: 14,
              letterSpacing: "0.05em", textTransform: "uppercase",
              border: "2px solid #d1d5db"
            }}>
              This home has sold
            </div>
          ) : (
            <button onClick={() => setShowInquiry(true)} style={{
              flex: 1, textAlign: "center",
              background: "var(--mint)", color: "var(--red-dark)",
              padding: "14px", borderRadius: 6, fontWeight: 700, fontSize: 14,
              letterSpacing: "0.05em", textTransform: "uppercase",
              border: "2px solid var(--red-dark)", cursor: "pointer"
            }}>
              📩 Inquire Now
            </button>
          )}
          <button onClick={handleShare} style={{
            width: 56, background: "var(--white)", color: "var(--black)",
            borderRadius: 6, border: "2px solid var(--black)", cursor: "pointer", fontSize: 18,
          }} title="Share this listing">
            {shareCopied ? "✅" : "🔗"}
          </button>
        </div>
        {shareCopied && (
          <p style={{ fontSize: 12, color: "var(--gray)", marginTop: 8, textAlign: "right" }}>Link copied!</p>
        )}
      </div>

      {showInquiry && company && (
        <InquiryModal
          listingId={listing.id}
          listingTitle={listing.title}
          companyId={company.id}
          onClose={() => setShowInquiry(false)}
        />
      )}
    </section>
  );
}
