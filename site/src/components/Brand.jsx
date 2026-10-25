export function RelayMark({ className = '' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="9"
        fill="#0D0F13"
        stroke="rgba(255,255,255,0.16)"
      />
      <path
        d="M10 10 22 22M22 10 10 22"
        stroke="rgba(243,240,232,0.32)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="2.4" fill="#F4A261" />
      <circle cx="22" cy="10" r="2.4" fill="#9AE6B4" />
      <circle cx="10" cy="22" r="2.4" fill="#9AE6B4" />
      <circle cx="22" cy="22" r="2.4" fill="#F4A261" />
    </svg>
  )
}

export function Wordmark({ className = '' }) {
  return (
    <a
      href="#top"
      className={`inline-flex items-center gap-2.5 text-cream ${className}`}
      aria-label="Relay, back to top"
    >
      <RelayMark className="h-8 w-8 shrink-0" />
      <span className="font-display text-[1.65rem] leading-none tracking-[-0.01em]">Relay</span>
    </a>
  )
}
