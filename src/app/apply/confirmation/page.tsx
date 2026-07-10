import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

interface Props {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function ApplicationConfirmationPage({
  searchParams,
}: Props) {
  const { session_id: sessionId } = await searchParams;

  if (!sessionId) {
    return (
      <ConfirmationLayout>
        <ErrorState message="Missing payment session. If you just paid, please check your email for a receipt, or contact the park directly." />
      </ConfirmationLayout>
    );
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    return (
      <ConfirmationLayout>
        <ErrorState message="We couldn't find that payment session. If you just paid, please check your email for a receipt, or contact the park directly." />
      </ConfirmationLayout>
    );
  }

  const applicationId = session.metadata?.application_id;
  const amountPaid = (session.amount_total ?? 0) / 100;
  const paid = session.payment_status === "paid";

  let applicantName: string | null = null;
  if (applicationId) {
    const { data } = await supabaseAdmin
      .from("resident_applications")
      .select("full_name")
      .eq("id", applicationId)
      .single();
    applicantName = data?.full_name ?? null;
  }

  if (!paid) {
    return (
      <ConfirmationLayout>
        <ErrorState message="This payment hasn't completed yet. If you believe this is a mistake, please contact the park directly." />
      </ConfirmationLayout>
    );
  }

  return (
    <ConfirmationLayout>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          Application Received!
        </h1>
        {applicantName && (
          <p style={{ color: "#666", fontSize: 15, marginTop: 6 }}>
            Thank you, {applicantName}.
          </p>
        )}
      </div>

      <div
        style={{
          background: "#f7f7f7",
          borderRadius: 10,
          padding: "18px 20px",
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>
          Application Fee Paid
        </div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>
          ${amountPaid.toFixed(2)}
        </div>
      </div>

      <div style={{ fontSize: 14, color: "#333", lineHeight: 1.6 }}>
        <p>
          <strong>What happens next:</strong>
        </p>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          <li style={{ marginBottom: 8 }}>
            Your background check is now being processed.
          </li>
          <li style={{ marginBottom: 8 }}>
            The park will review your application once results are in.
          </li>
          <li style={{ marginBottom: 8 }}>
            You'll be contacted by phone or email with a decision.
          </li>
        </ol>
      </div>

      <p style={{ fontSize: 13, color: "#999", marginTop: 28, textAlign: "center" }}>
        A receipt has been sent to your email. Questions? Contact the park
        directly using the number at the top of this page.
      </p>
    </ConfirmationLayout>
  );
}

function ConfirmationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "48px 20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#111",
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: "32px 28px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
      <p style={{ fontSize: 15, color: "#333" }}>{message}</p>
    </div>
  );
}
