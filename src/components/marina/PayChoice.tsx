"use client";

// Oct 24 (per Mely): "Pay now" vs "Charge to my account". Shown only when this marina lets
// boaters charge to their account and the boater is signed in; otherwise everything is paid now.
// On the demo, a short note explains that each marina chooses.
export default function PayChoice({ value, onChange, signedIn, accountAllowed, demo, payLabel = "Pay now" }: {
  value: string; onChange: (v: "card" | "account") => void; signedIn: boolean; accountAllowed: boolean; demo?: boolean; payLabel?: string;
}) {
  if (!accountAllowed) return null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {signedIn ? (
        <div className="mr-seg">
          <button type="button" aria-pressed={value !== "account"} onClick={() => onChange("card")}>{payLabel}</button>
          <button type="button" aria-pressed={value === "account"} onClick={() => onChange("account")}>Charge to my account</button>
        </div>
      ) : (
        <p className="mr-note" style={{ margin: 0 }}>Boaters can <a href="/marina/account">sign in</a> to charge it to their account.</p>
      )}
      {demo && (
        <p className="mr-demo-note">Demo: each marina chooses whether boaters may <b>charge to their account</b> or must <b>pay before they take anything</b>. This demo has both turned on so you can see them.</p>
      )}
    </div>
  );
}
