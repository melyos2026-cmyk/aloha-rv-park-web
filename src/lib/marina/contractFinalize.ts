import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildSignedContractPdf } from "@/lib/marina/contractPdf";
import { isDemoCompany } from "@/lib/marina/host";
import { slipRequestSigned } from "@/lib/marina/slipRequests";

// Oct 27 (per Mely — second marina signature): everything that happens once a contract is fully
// signed — invoices, the renewal, the slip request moving to "Signed", the signed PDF in the boat's
// Documents (and the demo resets). Runs when the boater signs, or — when the marina requires a
// second signature — when that manager signs.
const r2 = (n: number) => Math.round(n * 100) / 100;
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
function addMonthsISO(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const x = new Date(Date.UTC(y, m - 1 + n, Math.min(day, last)));
  return x.toISOString().slice(0, 10);
}

// Same numbering as the admin's Invoices (INV-YYYY-0001…).
async function insertInvoice(fields: Record<string, unknown>) {
  const prefix = `INV-${String(fields.issue_date).slice(0, 4)}-`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: last } = await supabaseAdmin.from("marina_invoices").select("invoice_number")
      .eq("company_id", fields.company_id as string).like("invoice_number", `${prefix}%`).order("invoice_number", { ascending: false }).limit(1);
    const n = last?.[0] ? parseInt(last[0].invoice_number.slice(prefix.length), 10) + 1 : 1;
    const { data, error } = await supabaseAdmin.from("marina_invoices").insert({ ...fields, invoice_number: prefix + String(n).padStart(4, "0") }).select("id").single();
    if (!error) return data.id as string;
    if (error.code === "23505" && error.message.includes("invoice_number")) continue;
    throw error;
  }
  throw new Error("Could not allocate an invoice number.");
}

export async function finalizeSignedContract(p: {
  company: any; memberId: string; member: { full_name: string; email: string | null }; k: any;
  name: string; signedAt: Date; ip: string; agent: string; sig: string | null; sigStyle: string | null;
}) {
  const { company, memberId, member, k, name, signedAt, ip, agent, sig, sigStyle } = p;
  const w = { company, memberId };
  // Oct 21 (per Mely): the contract price becomes the boater's invoice(s), so the
  // contract, the invoices and the boater's account always show the same amount.
  // Extras chosen on the contract (Fee Settings) go on the same invoices; the security
  // deposit gets its own invoice so it can be refunded at the end of the term.
  // Oct 21 (per Mely): on the DEMO marina every visitor shares one boater account, so
  // the previous demo signing's unpaid invoices are voided (the balance never piles up)…
  const demo = isDemoCompany(w.company);
  if (demo) {
    const { data: old } = await supabaseAdmin.from("marina_invoices").select("id").eq("company_id", w.company.id)
      .eq("member_id", w.memberId).eq("status", "open").not("contract_id", "is", null).neq("contract_id", k.id);
    for (const inv of old || []) {
      const { count } = await supabaseAdmin.from("marina_invoice_payments").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).is("returned_at", null);
      if (!count) await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Demo reset" }).eq("id", inv.id);
    }
  }

  if (Number(k.amount) > 0) {
    try {
      const { data: slip } = k.slip_id ? await supabaseAdmin.from("marina_slips").select("slip_name").eq("id", k.slip_id).maybeSingle() : { data: null };
      const extras: { name: string; amount: number; per: string; total: number }[] = Array.isArray(k.extras) ? k.extras : [];
      const monthlyExtras = extras.filter((x) => x.per === "month");
      const oneTime = extras.filter((x) => x.per !== "month");
      const n = k.billing === "monthly" ? Math.max(1, Number(k.installments) || 1) : 1;
      const total = r2(Number(k.amount));
      const each = Math.floor((total / n) * 100) / 100;
      const today = todayET();
      const first = k.start_date && k.start_date > today ? k.start_date : today;
      const base = { company_id: w.company.id, member_id: w.memberId, boat_id: k.boat_id, slip_id: k.slip_id, contract_id: k.id, customer_name: member.full_name, customer_email: member.email, issue_date: today };
      const renewalTag = k.renewal_id ? { renewal_id: k.renewal_id } : {};
      const label = `${slip ? `Slip ${slip.slip_name} — ` : ""}${k.title.replace(/\s+—\s+Slip.*$/, "")}`;
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        let amt = i === n - 1 ? r2(total - each * (n - 1)) : each;
        const parts: string[] = [];
        if (n > 1) { for (const x of monthlyExtras) { amt += Number(x.amount); parts.push(x.name); } }
        else { for (const x of extras) { amt += Number(x.total); parts.push(x.name); } }
        if (n > 1 && i === 0) for (const x of oneTime) { amt += Number(x.amount); parts.push(x.name); }
        const due = i === 0 ? first : addMonthsISO(k.start_date || first, i);
        ids.push(await insertInvoice({
          ...base, ...(i === 0 ? renewalTag : {}), category: "slip_fee", amount: r2(amt), due_date: due < today ? today : due,
          description: `${label}${n > 1 ? ` (payment ${i + 1} of ${n})` : ""}${parts.length ? ` · includes ${parts.join(", ")}` : ""}`,
        }));
      }
      if (Number(k.deposit) > 0) {
        ids.push(await insertInvoice({ ...base, category: "security_deposit", amount: r2(Number(k.deposit)), due_date: first, description: `Security deposit — ${label}` }));
      }
      await supabaseAdmin.from("marina_contracts").update({ invoice_ids: ids }).eq("id", k.id);
      // A signed renewal contract = the owner renewed.
      if (k.renewal_id) await supabaseAdmin.from("marina_renewals").update({ status: "renewed", renewed_at: new Date().toISOString() }).eq("id", k.renewal_id).eq("company_id", w.company.id);
    } catch (e: any) {
      console.error("contract invoices failed:", e?.message);
    }
  }

  // Oct 26 (per Mely): a contract from a slip request moves that request to "Signed".
  await slipRequestSigned(w.company.id, k.id);

  // Signed PDF → private bucket → the boat's Documents.
  // (company comes from the parameters)
  try {
    const bytes = await buildSignedContractPdf({
      marinaName: company.company_name, marinaAddress: company.address || "", domain: company.domain,
      contractId: k.id, title: k.title, body: k.body, bodyHash: k.body_hash,
      signerName: name, signerEmail: member.email || "", signedAt, ip, userAgent: agent, signatureImage: sig, signatureStyle: sigStyle,
      sentAt: k.sent_at, sentByName: k.sent_by_name, sentBySignature: (k as any).sent_by_signature || null, sentByTitle: (k as any).sent_by_title || null,
      countersignedBy: (k as any).countersigned_by_name || null, countersignedAt: (k as any).countersigned_at || null, countersignTitle: (k as any).countersign_title || null, countersignSignature: (k as any).countersign_signature || null, viewedAt: k.viewed_at || signedAt.toISOString(),
    });
    const path = `${w.company.id}/contracts/${k.id}.pdf`;
    const up = await supabaseAdmin.storage.from("marina-documents").upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (up.error) throw up.error;
    let docId: string | null = null;
    if (k.boat_id) {
      const fileName = `${k.title.replace(/[^\w\s.-]+/g, "").trim() || "Contract"} - signed ${signedAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" })}.pdf`;
      const { data: doc } = await supabaseAdmin.from("marina_boat_documents").insert({
        company_id: w.company.id, boat_id: k.boat_id, doc_type: "contract", file_name: fileName, file_path: path, expires_on: k.end_date || null,
      }).select("id").maybeSingle();
      docId = doc?.id || null;
    }
    await supabaseAdmin.from("marina_contracts").update({ pdf_path: path, document_id: docId }).eq("id", k.id);
  } catch (e: any) {
    // The signature itself is recorded; the office can still see it. Log the PDF problem.
    console.error("contract pdf failed:", e?.message);
  }

  // Demo only (Oct 21, per Mely): keep just the latest signed copy, so signed
  // contracts don't pile up in the demo boater's account.
  if (demo) {
    const { data: old } = await supabaseAdmin.from("marina_contracts").select("id, document_id, pdf_path")
      .eq("company_id", w.company.id).eq("member_id", w.memberId).eq("status", "signed").neq("id", k.id);
    for (const o of old || []) {
      await supabaseAdmin.from("marina_invoices").update({ contract_id: null }).eq("company_id", w.company.id).eq("contract_id", o.id);
      if (o.document_id) await supabaseAdmin.from("marina_boat_documents").delete().eq("company_id", w.company.id).eq("id", o.document_id);
      if (o.pdf_path) await supabaseAdmin.storage.from("marina-documents").remove([o.pdf_path]).then(() => {}, () => {});
      await supabaseAdmin.from("marina_contracts").delete().eq("company_id", w.company.id).eq("id", o.id).eq("status", "signed");
    }
  }

  // …and a fresh copy of the contract is waiting, so the next visitor can sign too.
  if (demo) {
    const { count: pending } = await supabaseAdmin.from("marina_contracts").select("id", { count: "exact", head: true })
      .eq("company_id", w.company.id).eq("member_id", w.memberId).in("status", ["sent", "viewed"]);
    if (!pending) {
      const { id: _id, status: _s, viewed_at: _v, signed_at: _sa, signer_name: _sn, signer_email: _se, signer_ip: _si, signer_agent: _sg,
        signature_image: _img, pdf_path: _p, document_id: _d, invoice_ids: _ii, cancelled_at: _c, cancel_reason: _cr, created_at: _ca, renewal_id: _r, ...copy } = k as any;
      await supabaseAdmin.from("marina_contracts").insert({ ...copy, status: "sent", sent_at: new Date().toISOString() }).then(() => {}, () => {});
    }
  }

}
