import { useEffect, useRef, useState } from 'react'
import { STEPS } from '../data/content.js'
import { asset } from '../lib/asset.js'
import { prefersReducedMotion, useReveal } from '../lib/motion.js'
import SectionLabel from './SectionLabel.jsx'

export default function HowItWorks() {
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const lineRef = useRef(null)
  const [activeStep, setActiveStep] = useState(0)

  useReveal(rootRef)

  useEffect(() => {
    const list = listRef.current
    const line = lineRef.current
    if (!list || !line) return undefined

    if (prefersReducedMotion()) {
      line.style.transform = 'scaleY(1)'
      return () => {
        line.style.transform = ''
      }
    }

    const steps = Array.from(list.querySelectorAll('[data-step]'))
    let frame = 0

    const read = () => {
      frame = 0
      const rect = list.getBoundingClientRect()
      const viewport = window.innerHeight
      const start = viewport * 0.72
      const end = viewport * 0.28
      const span = rect.height + start - end
      const progress = span > 0 ? Math.min(1, Math.max(0, (start - rect.top) / span)) : 0
      line.style.transform = `scaleY(${progress})`

      const marker = viewport * 0.45
      let next = 0
      steps.forEach((step, index) => {
        if (step.getBoundingClientRect().top <= marker) next = index
      })
      setActiveStep((current) => (current === next ? current : next))
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }

    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
      line.style.transform = ''
    }
  }, [])

  return (
    <section id="how-it-works" ref={rootRef} className="relative border-t border-line">
      <div className="mx-auto max-w-content px-gutter py-section">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <div data-reveal className="lg:sticky lg:top-28">
              <SectionLabel>How it works</SectionLabel>
              <h2 className="mt-6 text-balance font-display text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-cream">
                Three moves, from intent to diff.
              </h2>
              <p className="mt-5 max-w-[42ch] text-[15.5px] leading-[1.8] text-muted">
                Relay stays out of the way while you decide, then keeps a record of what each agent
                did.
              </p>

              <figure className="mt-8 hidden overflow-hidden rounded-card border border-line bg-panel2 lg:block">
                <picture>
                  <source
                    type="image/avif"
                    srcSet={`${asset('images/detail-architecture-800.avif')} 800w, ${asset('images/detail-architecture-1200.avif')} 1200w`}
                    sizes="(min-width: 1024px) 30vw, 92vw"
                  />
                  <source
                    type="image/webp"
                    srcSet={`${asset('images/detail-architecture-800.webp')} 800w, ${asset('images/detail-architecture-1200.webp')} 1200w`}
                    sizes="(min-width: 1024px) 30vw, 92vw"
                  />
                  <img
                    src={asset('images/detail-architecture-1200.jpg')}
                    srcSet={`${asset('images/detail-architecture-800.jpg')} 800w, ${asset('images/detail-architecture-1200.jpg')} 1200w`}
                    sizes="(min-width: 1024px) 30vw, 92vw"
                    width="1200"
                    height="1800"
                    loading="lazy"
                    decoding="async"
                    alt="Diagonal concrete beams and louvered vents beneath a brutalist walkway, with a wet floor reflecting the light."
                    className="aspect-[3/4] w-full object-cover opacity-85 grayscale contrast-[1.05]"
                  />
                </picture>
                <figcaption className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  <span>Structure before speed</span>
                  <span aria-hidden="true">Fig. 03</span>
                </figcaption>
              </figure>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div ref={listRef} className="relative pl-8 sm:pl-10">
              <div aria-hidden="true" className="absolute left-0 top-0 h-full w-px bg-line" />
              <div
                ref={lineRef}
                aria-hidden="true"
                className="progress-line absolute left-0 top-0 h-full w-px origin-top bg-accent"
                style={{ transform: 'scaleY(0)' }}
              />

              <ol>
                {STEPS.map((step, index) => {
                  const isActive = activeStep === index
                  return (
                    <li
                      key={step.number}
                      data-step
                      aria-current={isActive ? 'step' : undefined}
                      className="relative pb-16 last:pb-0 lg:pb-20"
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute -left-8 top-2 h-2 w-2 -translate-x-1/2 rounded-full ${
                          isActive ? 'bg-accent' : 'bg-muted/40'
                        }`}
                      />
                      <div className="flex items-baseline gap-4">
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-accent">
                          Step {String(index + 1).padStart(2, '0')}
                        </span>
                        <span
                          className={`font-display text-[2.6rem] leading-none tracking-[-0.02em] sm:text-[3rem] ${
                            isActive ? 'text-cream' : 'text-cream/40'
                          }`}
                        >
                          {step.number}
                        </span>
                      </div>
                      <h3 className="mt-3 text-balance text-[1.25rem] font-medium leading-snug tracking-[-0.01em] text-cream sm:text-[1.4rem]">
                        {step.title}
                      </h3>
                      <p className="mt-3 max-w-[52ch] text-[14.5px] leading-[1.8] text-muted">
                        {step.body}
                      </p>
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
