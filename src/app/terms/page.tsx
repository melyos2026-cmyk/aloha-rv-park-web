"use client";
import { useCompany } from "@/lib/CompanyContext";
import LegalPage from "@/components/LegalPage";

export default function TermsPage() {
  const { company } = useCompany();
  const name = company?.company_name || "Aloha RV Park";
  const email = company?.contact_email || "info@aloharvparkfl.com";
  const phone = company?.contact_phone || "(689) 252-0567";
  const address = company?.address || "4648 S. Orange Blossom Trl, Kissimmee, FL 34746";
  const p = { marginBottom: 10 } as const;

  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Use"
      updated="October 14, 2026"
      intro={
        <p>
          These Terms apply when you use the {name} website and resident portal, or receive text
          messages from us. Rental of a lot or reservation is also governed by the lease or
          reservation agreement you sign with the park. If something here conflicts with your signed
          agreement, your signed agreement controls.
        </p>
      }
      sections={[
        {
          title: "Using the website and portal",
          body: (
            <p>
              Use the site and portal only for lawful purposes and only for your own account. Keep
              your login details private, and tell us right away if you think someone else has used
              your account. We may suspend access if the site or portal is misused.
            </p>
          ),
        },
        {
          title: "Applications and reservations",
          body: (
            <p>
              Submitting an application or reservation request does not guarantee approval or
              availability. You agree that the information you give us is true and complete. Fees
              and charges are shown before you pay. Application and background screening fees are
              non-refundable once they are paid and the screening invitation has been sent.
            </p>
          ),
        },
        {
          title: "Payments",
          body: (
            <p>
              Payments are made through a third-party payment processor. By paying, you agree to the
              amount shown at checkout, including any processing fee shown. Refunds, when allowed, are
              handled under your lease or reservation terms and do not return the processing fee.
            </p>
          ),
        },
        {
          title: "Text message program",
          body: (
            <>
              <p style={p}>
                <strong>Program:</strong> {name} account notifications.
              </p>
              <p style={p}>
                <strong>Messages:</strong> By giving us your mobile number on a rental application,
                reservation or resident account, you agree to receive text messages from {name}
                about your account, such as invoice and payment notices, rental application
                invitations and reservation confirmations. Consent to receive text messages is not
                a condition of any purchase, rental or reservation.
              </p>
              <p style={p}>
                <strong>Frequency:</strong> Message frequency varies with your account activity.
              </p>
              <p style={p}>
                <strong>Cost:</strong> Message and data rates may apply.
              </p>
              <p style={p}>
                <strong>Opt out:</strong> Reply <strong>STOP</strong> at any time to stop receiving
                text messages. You will get one confirmation message, and then no more.
              </p>
              <p style={p}>
                <strong>Help:</strong> Reply <strong>HELP</strong>, or contact us at {phone} or {email}.
              </p>
              <p>
                Carriers are not liable for delayed or undelivered messages. See our{" "}
                <a href="/privacy" style={{ color: "var(--red-dark)", textDecoration: "underline" }}>Privacy Policy</a>{" "}
                for how we handle your information.
              </p>
            </>
          ),
        },
        {
          title: "Third-party services",
          body: (
            <p>
              The site and portal use services from other companies, such as payment processing,
              text and email delivery, and background screening. Those services have their own terms
              and privacy policies.
            </p>
          ),
        },
        {
          title: "Limits of liability",
          body: (
            <p>
              The site and portal are provided "as is." To the extent the law allows, {name} is not
              liable for interruptions, errors or losses that come from using the site or portal.
            </p>
          ),
        },
        {
          title: "Changes to these Terms",
          body: <p>We may update these Terms from time to time. The date at the top shows when they were last changed.</p>,
        },
        {
          title: "Contact us",
          body: (
            <p>
              {name}
              <br />
              {address}
              <br />
              <a href={`tel:${phone.replace(/[^\d]/g, "")}`} style={{ color: "var(--red-dark)" }}>{phone}</a>
              <br />
              <a href={`mailto:${email}`} style={{ color: "var(--red-dark)" }}>{email}</a>
            </p>
          ),
        },
      ]}
    />
  );
}
