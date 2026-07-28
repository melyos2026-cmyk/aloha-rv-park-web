"use client";

import { useEffect, useState } from "react";
import { useCompany } from "@/lib/CompanyContext";

type Product = { product_id: string; label: string; price: number; unit: string; taxable: boolean };

export default function PropanePage() {
  const { company } = useCompany();
  const [products, setProducts] = useState<Product[]>([]);
  const [tax, setTax] = useState({ enabled: false, ratePercent: 0 });
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [gallons, setGallons] = useState("");
  const [email, setEmail] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    product_label: string;
    quantity: number;
    unit: string;
    amount_total: number;
    qr_token: string;
  } | null>(null);

  const parkId = company?.park_id || "aloha";

  useEffect(() => {
    fetch(`/api/get-propane-pricing?park_id=${parkId}`)
      .then((res) => res.json())
      .then((result) => {
        const list = (result.products || []).filter((p: Product) => p.unit !== "gallon");
        setProducts(list);
        if (list.length > 0) setProductId(list[0].product_id);
        setTax(result.tax || { enabled: false, ratePercent: 0 });
        setLoadingPrices(false);
      })
      .catch(() => setLoadingPrices(false));
  }, [parkId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("propane_payment") !== "success") return;
    const sessionId = params.get("session_id");
    if (!sessionId) return;

    let attempts = 0;
    function fetchOrder() {
      fetch(`/api/get-propane-order?session_id=${encodeURIComponent(sessionId!)}`)
        .then((res) => res.json())
        .then((result) => {
          if (result.order) {
            setReceipt(result.order);
          } else if (attempts < 5) {
            attempts += 1;
            setTimeout(fetchOrder, 1500);
          }
        })
        .catch(() => {});
    }
    fetchOrder();
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const selected = products.find((p) => p.product_id === productId);
  const isVariable = selected?.unit === "gallon";
  const subtotal = selected
    ? isVariable
      ? (parseFloat(gallons) || 0) * Number(selected.price)
      : Number(selected.price) * quantity
    : 0;
  const taxApplies = tax.enabled && selected?.taxable;
  const salesTax = taxApplies ? subtotal * (tax.ratePercent / 100) : 0;
  const processingFee = subtotal * 0.04;
  const total = subtotal + salesTax + processingFee;

  async function handleCheckout() {
    setError("");
    if (!selected) {
      setError("No propane products configured.");
      return;
    }
    const qty = isVariable ? parseFloat(gallons) : quantity;
    if (!qty || qty <= 0) {
      setError(isVariable ? "Enter the number of gallons" : "Invalid quantity");
      return;
    }
    if (isVariable && qty > 200) {
      setError("Gallon amount too high");
      return;
    }
    if (!email && !lotNumber) {
      setError("Please enter your email, or your lot number if you're a resident.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/create-propane-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          quantity: qty,
          parkId,
          customerEmail: email || undefined,
          lotNumber: lotNumber || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start checkout");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "60px 24px" }}>
      <h1 style={{ fontFamily: "Playfair Display, serif", fontSize: 32, fontWeight: 900, marginBottom: 8 }}>
        ⛽ Buy Propane
      </h1>
      <p style={{ color: "var(--gray)", fontSize: 14, marginBottom: 32 }}>
        Pay online, then show your QR code to staff for pickup.
      </p>

      {receipt ? (
        <div style={{ border: "2px solid var(--black)", borderRadius: 8, padding: 28, textAlign: "center" }}>
          <h3 style={{ margin: "0 0 4px 0", fontSize: 18 }}>✅ Payment Confirmed</h3>
          <p style={{ color: "var(--gray)", fontSize: 13.5, margin: "0 0 16px 0" }}>
            {receipt.quantity} {receipt.unit === "gallon" ? "gallons" : "×"} {receipt.product_label} — $
            {Number(receipt.amount_total).toFixed(2)}
          </p>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(receipt.qr_token)}`}
            alt="Propane pickup QR code"
            style={{ width: 220, height: 220, margin: "0 auto 16px auto", display: "block" }}
          />
          <p style={{ fontSize: 12.5, color: "var(--gray)" }}>
            {receipt.unit === "gallon"
              ? "Show this code to staff for your fill-up. It can only be used once."
              : `Show this code to staff each time you pick up a tank — this code works once per tank purchased${receipt.quantity > 1 ? ` (${receipt.quantity} total, multiple visits OK)` : ""}.`}{" "}
            No refunds — unpicked-up tanks are not refundable.
          </p>
        </div>
      ) : loadingPrices ? (
        <p style={{ fontSize: 14, color: "var(--gray)" }}>Loading prices...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 12.5, color: "var(--gray)", margin: 0 }}>
            Need a motor home fill-up (by the gallon)? That's paid in person when we service you —
            call us or just come by.
          </p>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray)", display: "block", marginBottom: 4 }}>
              Product
            </label>
            <select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setQuantity(1);
                setGallons("");
                setError("");
              }}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 14 }}
            >
              {products.map((p) => (
                <option key={p.product_id} value={p.product_id}>
                  {p.label} — {p.unit === "gallon" ? `$${p.price}/gal` : `$${p.price}`}
                </option>
              ))}
            </select>
          </div>

          {isVariable ? (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray)", display: "block", marginBottom: 4 }}>
                Gallons
              </label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={gallons}
                onChange={(e) => setGallons(e.target.value)}
                placeholder="e.g. 8.5"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 14 }}
              />
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray)", display: "block", marginBottom: 4 }}>
                Quantity
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 14 }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray)", display: "block", marginBottom: 4 }}>
              Email (required, so we can send your QR code)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 14 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--gray)", display: "block", marginBottom: 4 }}>
              Lot # (residents only — use this instead of email if you prefer)
            </label>
            <input
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
              placeholder="e.g. A12"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 14 }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--gray)" }}>
            <span>Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          {taxApplies && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--gray)" }}>
              <span>Sales Tax ({tax.ratePercent}%)</span>
              <span>${salesTax.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--gray)" }}>
            <span>Card Processing Fee (4%)</span>
            <span>${processingFee.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, fontSize: 16, fontWeight: 700 }}>
            <span>Total</span>
            <span style={{ color: "var(--red)" }}>${total.toFixed(2)}</span>
          </div>

          {error && (
            <div style={{ background: "#fef2f2", color: "#dc2626", padding: "10px 12px", borderRadius: 6, fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={loading}
            style={{
              marginTop: 8,
              background: "var(--red)",
              color: "var(--white)",
              padding: "14px",
              borderRadius: 6,
              border: "none",
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Redirecting to payment..." : "Pay Now"}
          </button>
        </div>
      )}
    </div>
  );
}
