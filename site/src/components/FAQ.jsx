import { useRef } from 'react'
import { FAQS } from '../data/content.js'
import { useReveal } from '../lib/motion.js'
import SectionLabel from './SectionLabel.jsx'

export default function FAQ() {
  const rootRef = useRef(null)
  useReveal(rootRef)

  return (
    <section id="faq" ref={rootRef} className="border-t border-line">
      <div className="mx-auto max-w-content px-gutter py-section">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
          <div data-reveal className="lg:col-span-4">
            <SectionLabel>FAQ</SectionLabel>
            <h2 className="mt-6 text-balance font-display text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-cream">
              Questions worth asking.
            </h2>
            <p className="mt-5 max-w-[34ch] text-[14.5px] leading-[1.8] text-muted">
              Short answers, including the ones that are not flattering.
            </p>
          </div>

          <div data-reveal className="lg:col-span-8">
            <div className="border-t border-line">
              {FAQS.map((item) => (
                <details key={item.question} className="group border-b border-line">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 text-[15.5px] font-medium leading-snug text-cream [&::-webkit-details-marker]:hidden">
                    <span>{item.question}</span>
                    <svg
                      className="faq-icon mt-0.5 h-4 w-4 shrink-0 text-muted"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <p className="max-w-[68ch] pb-6 pr-8 text-[14.5px] leading-[1.8] text-muted">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
