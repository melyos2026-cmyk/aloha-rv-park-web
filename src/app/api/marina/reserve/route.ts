import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { startInvoicePayment } from "@/lib/marina/checkout";
import { round2, todayET } from "@/lib/marina/data";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { fitCheck } from "@/lib/marina/fit";
import { getMarinaSession } from "@/lib/marina/session";
import { loadBookingSettings, splitPayment, residentPricingFor, newBookingToken, loadTransientRules } from "@/lib/marina/booking";
import { stayPrice } from "@/lib/marina/stayPrice";
import { nameMatches } from "@/lib/marina/residency";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const feet = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 10) / 10 : null;
};

const STAYS = {
  transient_daily: { max: 30, label: "night" },
  transient_weekly: { max: 8, label: "week" },
  monthly: { max: 1, label: "month" }, // Oct 27: one month at most online; longer = Request a slip (contract)
} as const;
type Stay = keyof typeof STAYS;

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number) {
  const d = new Date(iso + "T12:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

// POST /api/marina/reserve — a visitor books and pays for an available slip online.
// The server decides the price from the marina's own rates; nothing the browser sends can change it.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let b: any;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (text(b.website, 100)) return NextResponse.json({ ok: true });

  const stay = String(b.stay_type) as Stay;
  if (!(stay in STAYS)) return NextResponse.json({ error: "Choose how long you will stay." }, { status: 400 });
  const units = Math.floor(Number(b.units));
  if (!Number.isFinite(units) || units < 1 || units > STAYS[stay].max) {
    return NextResponse.json({ error: `Choose between 1 and ${STAYS[stay].max} ${STAYS[stay].label}s.` }, { status: 400 });
  }

  const start = text(b.start_date, 10);
  const today = todayET();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < today || start > addDays(today, 365)) {
    return NextResponse.json({ error: "Choose an arrival date from today to one year from now." }, { status: 400 });
  }
  const end = stay === "transient_daily" ? addDays(start, units) : stay === "transient_weekly" ? addDays(start, 7 * units) : addMonths(start, units);

  // Oct 27 (per Mely — like real marinas): online = short stays only, and the guest accepts the
  // marina's dockage terms. Longer stays: Request a slip (contract).
  const rules = await loadTransientRules(company.id);
  const nights = Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86400000);
  const monthOk = stay === "monthly" && units === 1 && rules.maxNights >= 28;
  if (nights > rules.maxNights && !monthOk) return NextResponse.json({ error: `Online booking is for stays up to ${rules.maxNights} nights. For a longer stay, use "Request a slip" — the marina sends you a contract.`, longStay: true }, { status: 400 });
  if (b.accept_terms !== true) return NextResponse.json({ error: "Please read and accept the marina's dockage terms." }, { status: 400 });

  const name = text(b.guest_name, 120);
  const email = text(b.guest_email, 160).toLowerCase();
  const phone = text(b.guest_phone, 40);
  const boatLen = feet(b.boat_length_ft);
  if (name.length < 2) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (phone.length < 7) return NextResponse.json({ error: "Enter a phone number the dock office can call." }, { status: 400 });
  if (rules.maxDaysYear) {
    const { data: past } = await supabaseAdmin.from("marina_reservations").select("start_date, end_date").eq("company_id", company.id).ilike("guest_email", email.replace(/[%_\\]/g, "\\$&")).in("status", ["confirmed", "checked_in", "checked_out"]).gte("end_date", addDays(today, -365));
    const used = (past || []).reduce((t: number, r: any) => t + Math.max(0, Math.round((Date.parse(r.end_date + "T12:00:00Z") - Date.parse(r.start_date + "T12:00:00Z")) / 86400000)), 0);
    if (used + nights > rules.maxDaysYear) return NextResponse.json({ error: `This marina allows up to ${rules.maxDaysYear} nights a year of short stays per boater (you have ${used}). For a longer stay, use "Request a slip".`, longStay: true }, { status: 400 });
  }
  if (!boatLen) return NextResponse.json({ error: "Enter your boat length in feet." }, { status: 400 });
  const boatBeam = feet(b.boat_beam_ft);
  const boatDraft = feet(b.boat_draft_ft);

  const { data: slip } = await supabaseAdmin
    .from("marina_slips")
    .select("*")
    .eq("id", String(b.slip_id || ""))
    .eq("company_id", company.id)
    .maybeSingle();
  if (!slip) return NextResponse.json({ error: "That slip was not found." }, { status: 404 });
  const opensOn = typeof slip.available_from === "string" ? slip.available_from : null;
  const open = slip.status === "available" || (slip.status === "occupied" && !!opensOn && start >= opensOn);
  if (!open) {
    return NextResponse.json(
      { error: slip.status === "occupied" && opensOn ? `This slip is taken until ${opensOn}. Choose an arrival date on or after that day.` : "That slip is not open for booking." },
      { status: 409 },
    );
  }
  if (slip.length_ft && boatLen > Number(slip.length_ft)) {
    return NextResponse.json({ error: `This slip fits boats up to ${slip.length_ft} ft. Pick a longer slip.` }, { status: 400 });
  }
  if (slip.max_beam_ft && boatBeam && boatBeam > Number(slip.max_beam_ft)) {
    return NextResponse.json({ error: `This slip allows a beam up to ${slip.max_beam_ft} ft.` }, { status: 400 });
  }
  if (slip.max_draft_ft && boatDraft && boatDraft > Number(slip.max_draft_ft)) {
    return NextResponse.json({ error: `This slip allows a draft up to ${slip.max_draft_ft} ft.` }, { status: 400 });
  }
  // Oct 26 (per Mely): shore power the boat needs (30A / 50A…) against the slip's power.
  const fit = fitCheck(slip, { length: boatLen, beam: boatBeam, draft: boatDraft, power: text(b.power_needed, 10) || null });
  if (!fit.fits) return NextResponse.json({ error: fit.checks.filter((c) => !c.ok).map((c) => c.detail).join(". ") + "." }, { status: 400 });
  // A boat kept in the slip, or a contract (sent or signed) for these dates, takes the slip.
  const [{ data: keptBoat }, { data: kContracts }] = await Promise.all([
    supabaseAdmin.from("marina_boats").select("id").eq("company_id", company.id).eq("slip_id", slip.id).limit(1),
    supabaseAdmin.from("marina_contracts").select("id").eq("company_id", company.id).eq("slip_id", slip.id).in("status", ["sent", "viewed", "signed"]).lte("start_date", end).gte("end_date", start).limit(1),
  ]);
  // An open price quote for a slip request holds the slip too.
  const { data: held } = await supabaseAdmin.from("marina_slip_requests").select("status, quote_expires_at").eq("company_id", company.id).eq("slip_id", slip.id).in("status", ["quoted", "quote_accepted"]).lte("start_date", end).gte("end_date", start);
  const quoteHold = (held || []).some((h: any) => h.status === "quote_accepted" || !h.quote_expires_at || Date.parse(h.quote_expires_at) > Date.now());
  if ((keptBoat?.length && !(opensOn && start >= opensOn)) || kContracts?.length || quoteHold) {
    return NextResponse.json({ error: "That slip is already taken for those dates. Try other dates or another slip." }, { status: 409 });
  }

  // Oct 27 (per Mely): all of the slip's short-stay rates, so the best one applies by itself (7+ nights
  // weekly, 28+ monthly — stayPrice), and the resident rate for a signed-in resident or a guest whose
  // proof of residency was approved (or is waiting for the office: then the difference is charged if refused).
  const { data: rateRows } = await supabaseAdmin.from("marina_slip_rates").select("rate_type, resident_rate, non_resident_rate")
    .eq("slip_id", slip.id).eq("company_id", company.id).in("rate_type", ["transient_daily", "transient_weekly", "monthly"]);
  const session = await getMarinaSession(req);
  const memberId = session && session.companyId === company.id ? session.memberId : null;
  let resident = await residentPricingFor(company.id, memberId);
  let residency: { id: string; status: string } | null = null;
  let holdMode = false;
  if (!resident && rules.residentPricing && b.residency_check_id && /^[0-9a-f-]{36}$/.test(String(b.residency_check_id))) {
    // Oct 27 (review): only an APPROVED proof lowers the price — same email AND same name as the
    // booking, ID not expired, from the last 30 days, and with the 2 extra documents when required.
    const { data: rc } = await supabaseAdmin.from("marina_residency_checks").select("id, status, email, full_name, created_at, expires_on, ai").eq("id", String(b.residency_check_id)).eq("company_id", company.id).maybeSingle().then((x) => x, () => ({ data: null } as any));
    const needSupport = rules.residentProof === "id_plus_2" && nights >= 7;
    if (rc && ["approved", "pending"].includes(rc.status) && String(rc.email).toLowerCase() === email && nameMatches(name, [String(rc.full_name)]) && nameMatches(String(rc.full_name), [name])
      && Date.parse(rc.created_at) > Date.now() - 30 * 86400000 && (!rc.expires_on || rc.expires_on > today) && (!needSupport || rc.ai?.needSupport === true)) {
      // approved → resident price now; pending → card HOLD for the regular price until the office decides
      if (rc.status === "approved") resident = true; else holdMode = true;
      residency = { id: rc.id, status: rc.status };
    }
  }
  const pick = (t: string, res: boolean) => { const r: any = (rateRows || []).find((x: any) => x.rate_type === t); return r ? Number((res ? r.resident_rate ?? r.non_resident_rate : r.non_resident_rate ?? r.resident_rate) ?? 0) : 0; };
  const ratesFor = (res: boolean) => ({ daily: pick("transient_daily", res), weekly: pick("transient_weekly", res), monthly: pick("monthly", res) });
  const priced = stayPrice(stay, units, ratesFor(resident));
  const unitPrice = pick(stay, resident) || pick("transient_daily", resident) * (stay === "transient_weekly" ? 7 : 1); // first-night deposit base
  if (!(unitPrice > 0) || !priced) return NextResponse.json({ error: "This stay length is not offered online for this slip. Call the dock office." }, { status: 400 });
  const amount = priced.total;
  const nonResidentAmount = residency ? stayPrice(stay, units, ratesFor(false))?.total ?? amount : null;
  const residentAmount = holdMode ? stayPrice(stay, units, ratesFor(true))?.total ?? null : null;
  if (holdMode && !(residentAmount && residentAmount < amount)) holdMode = false; // no cheaper resident price: a normal booking
  if (holdMode) { // the hold columns must exist (SQL 93), or the booking couldn't be confirmed by the hold
    const { error: hc } = await supabaseAdmin.from("marina_reservations").select("hold_pi, resident_amount").limit(1);
    if (hc) holdMode = false;
  }
  // Oct 26 (per Mely): deposit now, balance later — when the marina chose it.
  const split = holdMode ? { payNow: amount, balance: 0, balanceDue: null as string | null } : splitPayment(await loadBookingSettings(company.id), amount, unitPrice, stay, start); // a hold is for the whole stay

  // Flood guard, then date conflicts (a pending hold only counts for 30 minutes).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("marina_reservations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .gte("created_at", hourAgo);
  if ((count || 0) >= 60) return NextResponse.json({ error: "Too many requests right now. Please call the dock office." }, { status: 429 });
  if (await tooManyFromIp(req, `reserve:${company.id}`, 6)) return NextResponse.json({ error: "Too many requests from this device. Please call the dock office." }, { status: 429 });

  const holdSince = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: clashes } = await supabaseAdmin
    .from("marina_reservations")
    .select("id, status, created_at")
    .eq("slip_id", slip.id)
    .in("status", ["confirmed", "pending"])
    .lt("start_date", end)
    .gt("end_date", start);
  if ((clashes || []).some((c) => c.status === "confirmed" || c.created_at > holdSince)) {
    return NextResponse.json({ error: "That slip is already booked for those dates. Try other dates or another slip." }, { status: 409 });
  }

  // Invoice (appears in the marina's Invoices screen) + reservation, then payment.
  let invoice: { id: string; invoice_number: string } | null = null;
  for (let i = 0; i < 5 && !invoice; i++) {
    const number = `WEB-${today.replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const { data, error } = await supabaseAdmin
      .from("marina_invoices")
      .insert({
        company_id: company.id,
        invoice_number: number,
        category: "slip_fee",
        slip_id: slip.id,
        customer_name: name,
        customer_email: email,
        description: split.balance ? `Deposit for slip ${slip.slip_name} reservation, ${start} to ${end}` : `Slip ${slip.slip_name} reservation, ${start} to ${end}`,
        amount: split.payNow,
        member_id: memberId,
        issue_date: today,
        due_date: today,
      })
      .select("id, invoice_number")
      .single();
    if (data) invoice = data;
    else if (error?.code !== "23505") return NextResponse.json({ error: "Could not create your reservation. Please try again." }, { status: 500 });
  }
  if (!invoice) return NextResponse.json({ error: "Could not create your reservation. Please try again." }, { status: 500 });

  const { data: reservation, error: resErr } = await supabaseAdmin
    .from("marina_reservations")
    .insert({
      company_id: company.id,
      slip_id: slip.id,
      invoice_id: invoice.id,
      guest_name: name,
      guest_email: email,
      guest_phone: phone,
      boat_name: text(b.boat_name, 120) || null,
      boat_length_ft: boatLen,
      boat_beam_ft: boatBeam,
      boat_draft_ft: boatDraft,
      stay_type: stay,
      units,
      start_date: start,
      end_date: end,
      amount,
      status: "pending",
    })
    .select("id")
    .single();
  if (resErr || !reservation) {
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Reservation could not be saved" }).eq("id", invoice.id);
    return NextResponse.json({ error: "Could not create your reservation. Please try again." }, { status: 500 });
  }

  // Private booking page + deposit details (scripts/marina_73…; skipped quietly before it runs).
  const token = newBookingToken();
  const { error: extraErr } = await supabaseAdmin.from("marina_reservations").update({
    access_token: token, member_id: memberId, power_needed: text(b.power_needed, 10) || null,
    deposit_amount: split.balance ? split.payNow : null, balance_due_date: split.balanceDue,
  }).eq("id", reservation.id).eq("company_id", company.id);
  if (extraErr && split.balance) {
    // Without the new columns a deposit can't be tracked: charge the full stay instead.
    await supabaseAdmin.from("marina_invoices").update({ amount, description: `Slip ${slip.slip_name} reservation, ${start} to ${end}` }).eq("id", invoice.id).eq("company_id", company.id);
    split.payNow = amount; split.balance = 0; split.balanceDue = null;
  }
  const page = extraErr ? null : `/marina/reservation/${reservation.id}?t=${token}`;
  // the dockage terms the guest accepted: when, from where, and exactly which text (fingerprint)
  await supabaseAdmin.from("marina_reservations").update({
    terms_accepted_at: new Date().toISOString(), terms_accepted_ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60) || null,
    terms_hash: crypto.createHash("sha256").update(rules.dockageTerms, "utf8").digest("hex"),
  }).eq("id", reservation.id).eq("company_id", company.id).then(() => null, () => null);
  await supabaseAdmin.from("marina_reservations").update({ terms_text: rules.dockageTerms.slice(0, 6000) }).eq("id", reservation.id).eq("company_id", company.id).then(() => null, () => null); // the exact words accepted
  // Oct 27: when they expect to arrive (the dock office sees it in Today), and the residency proof used
  const eta = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.arrival_time || "")) ? String(b.arrival_time) : null;
  if (eta) await supabaseAdmin.from("marina_reservations").update({ arrival_time: eta }).eq("id", reservation.id).eq("company_id", company.id).then(() => null, () => null);
  if (residency) await supabaseAdmin.from("marina_reservations").update({ residency_check_id: residency.id, non_resident_amount: nonResidentAmount, resident_status: holdMode ? "pending" : residency.status, ...(holdMode ? { resident_amount: residentAmount } : {}) }).eq("id", reservation.id).eq("company_id", company.id).then(() => null, () => null);

  const origin = `https://${company.domain}`;
  const pay = await startInvoicePayment({
    company,
    invoiceId: invoice.id,
    hold: holdMode,
    successUrl: page ? `${origin}${page}&paid=1` : `${origin}/?reserved=success#slips`,
    cancelUrl: `${origin}/?reserved=cancelled#slips`,
  });
  if (!pay.ok) {
    await supabaseAdmin.from("marina_reservations").update({ status: "cancelled" }).eq("id", reservation.id);
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Payment could not be started" }).eq("id", invoice.id);
    return NextResponse.json({ error: pay.error }, { status: pay.status });
  }

  const summary = { hold: holdMode, residentAmount, slip: slip.slip_name, dock: slip.dock, start, end, amount, invoice: invoice.invoice_number, paidNow: split.payNow, balance: split.balance, balanceDue: split.balanceDue, page, resident };
  return NextResponse.json("url" in pay ? { url: pay.url, summary } : { ok: true, demo: true, summary });
}
