import type { NextConfig } from "next";

// Oct 26 (security review): security headers for every page.
//  - nosniff + referrer policy everywhere.
//  - No framing by other sites (clickjacking) and a locked-down Permissions-Policy everywhere
//    EXCEPT /marina/live-map, which is meant to be embedded: the MelyOS office shows it in an
//    iframe (admin.melyos.io) and marinas paste it into their own websites (with
//    allow="geolocation"). (The RV park map is a separate deployment, not this site.)
//  - camera=(self): document/ID uploads let people take a photo with the camera.
//  - No script-src CSP on purpose: it would break Stripe and the inline scripts.
const everywhere = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];
const notEmbeddable = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: everywhere },
      { source: "/((?!marina/live-map).*)", headers: notEmbeddable },
    ];
  },
};

export default nextConfig;
