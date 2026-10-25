import { useRef } from 'react'
import { FEATURES } from '../data/content.js'
import { useReveal } from '../lib/motion.js'
import SectionLabel from './SectionLabel.jsx'

export default function FeatureGrid() {
  const rootRef = useRef(null)
  useReveal(rootRef)

  return (
    <section ref={rootRef} aria-labelledby="features-heading" className="border-t border-line">
      <div className="mx-auto max-w-content px-gutter py-section">
        <div data-reveal className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-16">
          <div className="lg:col-span-8">
            <SectionLabel>The workspace</SectionLabel>
            <h2
              id="features-heading"
              className="mt-6 text-balance font-display text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-cream"
            >
              The parts you actually touch.
            </h2>
          </div>
          <p className="max-w-[40ch] text-[15px] leading-[1.8] text-muted lg:col-span-4">
            No dashboard theatre. Six surfaces that hold the work: sessions, keys, modes, notes,
            instructions, and the stop button.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 border-l border-t border-line sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.index}
              data-reveal
              className="feature-card group relative border-b border-r border-line p-6 sm:p-7 lg:p-8"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted">
                {feature.index}
              </span>
              <h3 className="mt-8 font-display text-[1.5rem] leading-[1.15] tracking-[-0.01em] text-cream sm:text-[1.65rem]">
                {feature.title}
              </h3>
              <p className="mt-3 max-w-[42ch] text-[14.5px] leading-[1.75] text-muted">
                {feature.body}
              </p>
              <span
                aria-hidden="true"
                className="feature-underline absolute bottom-0 left-0 h-px w-full origin-left bg-accent/60"
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
