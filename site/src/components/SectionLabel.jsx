export default function SectionLabel({ children, className = '' }) {
  return (
    <p className={`eyebrow ${className}`}>
      <span aria-hidden="true" className="h-px w-7 shrink-0 bg-accent/70" />
      <span>{children}</span>
    </p>
  )
}
