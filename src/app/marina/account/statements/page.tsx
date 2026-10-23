import { notFound, redirect } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { currentBoater } from "@/lib/marina/documents";
import { loadAccount } from "@/lib/marina/data";
import Statements from "@/components/marina/Statements";

// Oct 23 (per Mely): the boater's payments, receipts and printable statements on their own
// page, like a bank statement (search, year and month, totals, print).
export const dynamic = "force-dynamic";
export const metadata = { title: "Payments & statements", robots: { index: false } };

export default async function Page() {
  const company = await getMarinaForPage();
  if (!company) notFound();
  const memberId = await currentBoater(company.id);
  if (!memberId) redirect("/marina/account");
  const acct = await loadAccount(company.id, memberId);
  if (!acct) redirect("/marina/account");
  return (
    <Statements
      company={{ name: company.company_name, address: company.address, phone: company.contact_phone, email: company.contact_email, logo: company.logo_url, domain: company.domain }}
      member={{ name: acct.member.full_name, email: acct.member.email }}
      payments={acct.payments}
      openInvoices={acct.invoices.filter((i) => i.balance > 0).map((i) => ({ id: i.id, number: i.invoice_number, description: i.description, due: i.due_date, balance: i.balance, overdue: i.overdue }))}
    />
  );
}
