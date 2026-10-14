import { redirect } from "next/navigation";

// /residents has no page of its own (it was a 404 when scanned from the
// QR flyer). Send people to the resident dashboard, which itself sends
// anyone not signed in to /login.
export default function ResidentsIndex() {
  redirect("/residents/dashboard");
}
