import crypto from "crypto";

const CHECKR_API_BASE =
  process.env.CHECKR_API_BASE_URL || "https://api.checkr-staging.com/v1";
const CHECKR_API_KEY = process.env.CHECKR_API_KEY as string;
const CHECKR_PACKAGE = process.env.CHECKR_PACKAGE_ID as string;

function checkrAuthHeader() {
  const encoded = Buffer.from(`${CHECKR_API_KEY}:`).toString("base64");
  return `Basic ${encoded}`;
}

async function checkrRequest(path: string, options: RequestInit = {}) {
  const res = await fetch(`${CHECKR_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: checkrAuthHeader(),
      ...(options.headers || {}),
    },
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Checkr API error (${res.status}) on ${path}: ${JSON.stringify(json)}`
    );
  }
  return json;
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = (fullName || "").trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  if (parts.length <= 1) {
    return { firstName: cleaned || "Applicant", lastName: "—" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function createCheckrInvitation(params: {
  applicationId: string;
  personKey: string;
  email: string;
  fullName: string;
  state?: string;
}) {
  const { firstName, lastName } = splitName(params.fullName);
  const customId = `${params.applicationId}::${params.personKey}`;

  const candidate = await checkrRequest("/candidates", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      first_name: firstName,
      last_name: lastName,
      custom_id: customId,
      work_locations: [{ country: "US", state: params.state || "FL" }],
    }),
  });

  const invitation = await checkrRequest("/invitations", {
    method: "POST",
    body: JSON.stringify({
      candidate_id: candidate.id,
      package: CHECKR_PACKAGE,
    }),
  });

  return { candidateId: candidate.id, invitationId: invitation.id };
}

export async function resolveCandidate(
  candidateId: string
): Promise<{ applicationId: string; personKey: string } | null> {
  const candidate = await checkrRequest(`/candidates/${candidateId}`);
  const customId: string = candidate.custom_id || "";
  const [applicationId, personKey] = customId.split("::");
  if (!applicationId || !personKey) return null;
  return { applicationId, personKey };
}

export interface CheckrResultEntry {
  personKey: string;
  name: string;
  candidateId?: string;
  status: string;
}

export function computeAggregateStatus(results: CheckrResultEntry[]): string {
  if (results.length === 0) return "payment_confirmed";
  if (results.some((r) => r.status === "Needs Review")) return "Needs Review";
  if (results.some((r) => r.status === "invitation_failed")) return "invitation_sent";
  if (results.some((r) => r.status === "invitation_expired")) return "invitation_expired";
  if (results.every((r) => r.status === "Passed")) return "Passed";
  if (results.some((r) => r.status === "in_progress")) return "in_progress";
  return "invitation_sent";
}

export function verifyCheckrSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  const expected = crypto
    .createHmac("sha256", CHECKR_API_KEY)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
