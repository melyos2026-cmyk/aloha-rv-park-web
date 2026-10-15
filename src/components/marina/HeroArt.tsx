// Original illustration (no photos required). A marina hero_image_url set in
// the admin replaces this automatically.
export default function HeroArt() {
  return (
    <svg className="mr-hero-art" viewBox="0 0 640 480" role="img" aria-label="Illustration of boats moored along a wooden dock at sunset">
      <defs>
        <linearGradient id="hs" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#12485b" />
          <stop offset=".55" stopColor="#e9985b" />
          <stop offset="1" stopColor="#f6c76f" />
        </linearGradient>
        <linearGradient id="hw" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a6b79" />
          <stop offset="1" stopColor="#0b2f3d" />
        </linearGradient>
      </defs>
      <rect width="640" height="480" fill="url(#hs)" />
      <circle cx="470" cy="215" r="58" fill="#fff3c9" opacity=".95" />
      <rect y="250" width="640" height="230" fill="url(#hw)" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={430 - i * 14 + (i % 2) * 20} y={262 + i * 14} width={80 + i * 16} height="3" rx="1.5" fill="#fff3c9" opacity={0.55 - i * 0.07} />
      ))}
      {/* sailboat */}
      <g transform="translate(110 150)">
        <path d="M70 0 L70 118 L8 118 Z" fill="#fdf6e4" />
        <path d="M78 24 L78 118 L130 118 Z" fill="#f3e2b8" />
        <path d="M0 126 H150 L128 156 H22 Z" fill="#0a2230" />
        <rect x="68" y="-6" width="4" height="130" fill="#0a2230" />
      </g>
      {/* motor yacht */}
      <g transform="translate(335 255)">
        <path d="M0 40 H190 L168 82 H22 Z" fill="#f4f8f8" />
        <path d="M14 40 L40 6 H132 L156 40 Z" fill="#d8ecea" />
        <rect x="52" y="14" width="22" height="16" rx="2" fill="#0f3b4c" />
        <rect x="82" y="14" width="22" height="16" rx="2" fill="#0f3b4c" />
        <rect x="112" y="14" width="22" height="16" rx="2" fill="#0f3b4c" />
        <rect x="22" y="58" width="146" height="5" fill="#f0a81c" />
      </g>
      {/* dock */}
      <path d="M0 380 H640 V420 H0 Z" fill="#b99a6b" />
      <path d="M0 380 H640 V388 H0 Z" fill="#cdb084" />
      {Array.from({ length: 27 }).map((_, i) => (
        <rect key={i} x={i * 24} y="388" width="2" height="32" fill="#8d7149" />
      ))}
      {[40, 200, 360, 520].map((x) => (
        <g key={x}>
          <rect x={x} y="352" width="10" height="30" rx="3" fill="#0a2230" />
          <circle cx={x + 5} cy="350" r="6" fill="#0a2230" />
        </g>
      ))}
      <rect y="420" width="640" height="60" fill="#0b2f3d" />
    </svg>
  );
}
