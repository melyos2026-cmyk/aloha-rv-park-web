"use client";
import { useCompany } from "@/lib/CompanyContext";
import LegalPage from "@/components/LegalPage";

export default function PrivacyPage() {
  const { company } = useCompany();
  const name = company?.company_name || "Aloha RV Park";
  const email = company?.contact_email || "info@aloharvparkfl.com";
  const phone = company?.contact_phone || "(689) 252-0567";
  const address = company?.address || "4648 S. Orange Blossom Trl, Kissimmee, FL 34746";
  const p = { marginBottom: 10 } as const;

  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="October 19, 2026"
      intro={
        <p>
          This Privacy Policy explains how {name} ("we," "us") collects, uses and protects personal
          information when you visit our website, apply to stay with us, make a reservation, use the
          resident portal, or receive messages from us. Our website and resident portal are provided
          with software from MelyOS LLC, which processes information on our behalf.
        </p>
      }
      sections={[
        {
          title: "Information we collect",
          body: (
            <>
              <p style={p}>We collect the information you give us, such as:</p>
              <ul style={{ paddingLeft: 22 }}>
                <li>Your name, email address, mailing address and phone number.</li>
                <li>Rental application details, including information about your RV, vehicles and additional occupants.</li>
                <li>Payment and billing records. Card and bank details are entered on our payment processor's secure page and are not stored by us.</li>
                <li>If you apply to stay with us, the results of a background screening, as described below.</li>
                <li>Reservation details, maintenance requests and messages you send us.</li>
              </ul>
            </>
          ),
        },
        {
          title: "How we use it",
          body: (
            <p>
              We use your information to process applications and reservations, set up and manage your
              account, send invoices and receipts, collect payments, respond to requests, keep the park
              safe, and meet legal requirements. We do not sell your personal information.
            </p>
          ),
        },
        {
          title: "Text messages (SMS)",
          body: (
            <>
              <p style={p}>
                If you agree to receive text messages (by checking the optional box on our{" "}
                <a href="/text-messages" style={{ color: "var(--red-dark)", textDecoration: "underline" }}>Text Message Alerts</a>{" "}
                page, rental application or resident portal, or by telling our office staff), we send
                you text messages about your account, such as invoice and payment notices, rental
                application invitations and reservation confirmations. We keep a record of when you
                agreed. These messages are not marketing messages.
              </p>
              <p style={p}>
                <strong>We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes.</strong>{" "}
                We also do not share your mobile phone number or text messaging consent with third parties or affiliates for their marketing or promotional purposes.{" "}
                Mobile numbers are shared only with the service providers that deliver our messages
                on our behalf.
              </p>
              <p>
                You can stop text messages at any time by replying <strong>STOP</strong>. Reply{" "}
                <strong>HELP</strong> for help. Message and data rates may apply. See our{" "}
                <a href="/terms" style={{ color: "var(--red-dark)", textDecoration: "underline" }}>Terms</a>{" "}
                for details.
              </p>
            </>
          ),
        },
        {
          title: "Background screening",
          body: (
            <p>
              Applicants may be asked to complete a background screening as part of the rental
              application. A screening company prepares the report, and we use it only to evaluate the
              application, as allowed by law. If we decide not to approve an application based on a
              report, we will tell you and explain your rights under the Fair Credit Reporting Act.
            </p>
          ),
        },
        {
          title: "Who we share information with",
          body: (
            <p>
              We share information only with service providers that help us run the park and the
              website: our software provider (MelyOS LLC), payment processors, email and text
              message delivery services, and screening companies. We may also share information when
              the law requires it. These providers may use your information only to provide their
              services to us.
            </p>
          ),
        },
        {
          title: "Keeping your information safe",
          body: (
            <p>
              We use reasonable technical and organizational measures to protect your information.
              No system is completely secure, so we cannot guarantee absolute security.
            </p>
          ),
        },
        {
          title: "How long we keep it",
          body: (
            <p>
              We keep information for as long as needed to manage your stay or application, keep
              required business and tax records, and meet legal obligations.
            </p>
          ),
        },
        {
          title: "Your choices",
          body: (
            <p>
              You can ask us to see, correct or delete your information, subject to legal and
              record-keeping requirements. You can stop text messages at any time by replying STOP.
              To make a request, contact us using the details below.
            </p>
          ),
        },
        {
          title: "Changes to this policy",
          body: <p>We may update this policy from time to time. The date at the top shows when it was last changed.</p>,
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
