// Oct 21 (per Mely): shows contract text formatted like a legal document.
// "# " line = centered title, "## " line = section heading, other lines = paragraphs.
export default function ContractText({ body, owner, marina, signedName, signedAt, sentBy, sentAt, sentBySignature, sentByTitle, signatureImage }: {
  body: string; owner: string; marina: string; signedName?: string | null; signedAt?: string | null; sentBy?: string | null; sentAt?: string | null;
  sentBySignature?: string | null; sentByTitle?: string | null; signatureImage?: string | null; // Oct 27: adopted signatures
}) {
  const when = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");
  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "#111827", fontSize: 14.5, lineHeight: 1.65, textAlign: "justify" }}>
      {body.split("\n").map((raw, i) => {
        const l = raw.trimEnd();
        if (!l.trim()) return null;
        if (l.startsWith("# ")) return <h2 key={i} style={{ textAlign: "center", fontSize: 19, fontWeight: 700, letterSpacing: ".04em", margin: "4px 0 18px" }}>{l.slice(2)}</h2>;
        if (l.startsWith("## ")) return <h3 key={i} style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: ".03em", margin: "18px 0 6px" }}>{l.slice(3)}</h3>;
        return <p key={i} style={{ margin: "0 0 9px" }}>{l}</p>;
      })}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginTop: 28, textAlign: "left" }}>
        {[["OWNER", signedName ? `/s/ ${signedName}` : "", owner, signedName ? `Signed electronically ${when(signedAt)}` : "Not signed yet", signedName ? signatureImage || "" : ""],
          ["MARINA", sentBy ? `/s/ ${sentBy}` : "", `${marina}, by its authorized representative${sentBy ? ` ${sentBy}` : ""}${sentByTitle ? `, ${sentByTitle}` : ""}`, sentAt ? `Issued electronically ${when(sentAt)}` : "", sentBySignature || ""]].map(([who, sig, name, note, img]) => (
          <div key={who}>
            <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: ".1em" }}>{who}</div>
            <div style={{ borderBottom: "1px solid #111827", minHeight: 34, fontStyle: "italic", fontSize: 18, paddingTop: 8 }}>
              {/^data:image\/png;base64,/.test(img) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt={`Signature of ${who === "MARINA" ? sentBy : signedName}`} style={{ height: 40, maxWidth: "100%", objectFit: "contain", display: "block" }} />
              ) : sig}
            </div>
            <div style={{ fontSize: 13 }}>{name}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
