import { useRef } from 'react'
import { TRUST_POINTS } from '../data/content.js'
import { asset } from '../lib/asset.js'
import { useReveal } from '../lib/motion.js'
import SectionLabel from './SectionLabel.jsx'

const TRAIL_SIZES = '(min-width: 1024px) 34vw, 92vw'

export default function SecuritySection() {
  const rootRef = useRef(null)
  useReveal(rootRef)

  return (
    <section id="security" ref={rootRef} className="relative border-t border-line bg-panel/25">
      <div className="mx-auto max-w-content px-gutter py-section">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-16">
          <div data-reveal className="lg:col-span-7">
            <SectionLabel>Your machine is the boundary.</SectionLabel>
            <h2 className="mt-6 text-balance font-display text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-cream">
              Local is the feature.
            </h2>
          </div>
          <p data-reveal className="max-w-[44ch] text-[15px] leading-[1.8] text-muted lg:col-span-5">
            Relay keeps the network surface small and the keys on disk. It does not claim to be a
            sandbox, and it does not encrypt your credentials.
          </p>
        </div>

        <dl className="mt-12 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3 lg:mt-16">
          {TRUST_POINTS.map((point) => (
            <div key={point.number} data-reveal className="bg-ink p-6 sm:p-7">
              <dt className="flex items-baseline gap-3">
                <span className="font-mono text-[10.5px] tracking-[0.18em] text-accent/80">
                  {point.number}
                </span>
                <span className="text-[15px] font-medium leading-snug text-cream">
                  {point.title}
                </span>
              </dt>
              <dd className="mt-3 text-[14.5px] leading-[1.75] text-muted">
                {point.number === '02' ? (
                  <>
                    Connected API keys live in{' '}
                    <code className="break-words text-cream/90">sessions/connections.json</code> with
                    best-effort 0600 permissions. The browser only gets a masked hint.
                  </>
                ) : (
                  point.body
                )}
              </dd>
            </div>
          ))}
        </dl>

        <div
          data-reveal
          className="mt-10 overflow-hidden rounded-card border border-line bg-panel lg:mt-12"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12">
            <div className="relative lg:col-span-5">
              <picture>
                <source
                  type="image/avif"
                  srcSet={`${asset('images/night-trails-1200.avif')} 1200w, ${asset('images/night-trails-1800.avif')} 1800w`}
                  sizes={TRAIL_SIZES}
                />
                <source
                  type="image/webp"
                  srcSet={`${asset('images/night-trails-1200.webp')} 1200w, ${asset('images/night-trails-1800.webp')} 1800w`}
                  sizes={TRAIL_SIZES}
                />
                <img
                  src={asset('images/night-trails-1200.jpg')}
                  srcSet={`${asset('images/night-trails-1200.jpg')} 1200w, ${asset('images/night-trails-1800.jpg')} 1800w`}
                  sizes={TRAIL_SIZES}
                  width="1200"
                  height="800"
                  loading="lazy"
                  decoding="async"
                  alt="Long-exposure red light trails sweeping across a city road at night beneath amber streetlights."
                  className="h-56 w-full object-cover opacity-80 sm:h-72 lg:h-full lg:min-h-[320px]"
                />
              </picture>
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-r from-ink/20 to-panel/40 lg:bg-gradient-to-r lg:from-ink/10 lg:to-panel"
              />
            </div>

            <div className="p-6 sm:p-8 lg:col-span-7 lg:p-10">
              <p className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-danger">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-danger" />
                Not a sandbox
              </p>

              <h3 className="mt-5 text-balance font-display text-[1.85rem] leading-[1.1] tracking-[-0.01em] text-cream sm:text-[2.1rem]">
                Relay is not a sandbox. Review what your agents can access.
              </h3>

              <p className="mt-4 max-w-[56ch] text-[14.5px] leading-[1.8] text-muted">
                Agents run with your OS permissions. Point Relay at the project folder you mean to
                touch, read the diff before accepting it, and use a container or VM when the blast
                radius matters.
              </p>

              <ul className="mt-6 grid grid-cols-1 gap-2.5 border-t border-line pt-5 sm:grid-cols-2">
                {[
                  'Loopback binding, not a public port',
                  'Keys in a local file, not encrypted',
                  'Caps and stop controls per run',
                  'Your review is the last gate',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 font-mono text-[11px] text-cream/80">
                    <span aria-hidden="true" className="mt-[0.55em] h-px w-3 shrink-0 bg-danger/60" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
