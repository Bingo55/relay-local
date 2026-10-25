import { useEffect, useRef, useState } from 'react'
import { INSTALL_COMMANDS } from '../data/content.js'
import { asset } from '../lib/asset.js'
import { useReveal } from '../lib/motion.js'
import SectionLabel from './SectionLabel.jsx'

async function writeClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.top = '0'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  } catch {
    return false
  }
}

export default function InstallSection() {
  const rootRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const timer = useRef(0)

  useReveal(rootRef)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onCopy = async () => {
    const ok = await writeClipboard(INSTALL_COMMANDS)
    setStatus(ok ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus('idle'), 2400)
  }

  const label =
    status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy commands'

  return (
    <section id="install" ref={rootRef} className="relative border-t border-line">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="glow glow-amber left-1/2 top-0 h-[420px] w-[420px] -translate-x-1/2" />
      </div>

      <div className="relative mx-auto max-w-content px-gutter py-section">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-16">
          <div data-reveal className="lg:col-span-7">
            <SectionLabel>Install</SectionLabel>
            <h2 className="mt-6 text-balance font-display text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-cream">
              Run it locally.
            </h2>
          </div>
          <p data-reveal className="max-w-[44ch] text-[15px] leading-[1.8] text-muted lg:col-span-5">
            Clone the repository, install dependencies, and start the app. Relay serves on loopback
            and opens in your browser.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:mt-16 lg:grid-cols-12 lg:gap-8">
          <div data-reveal className="lg:col-span-8">
            <div className="overflow-hidden rounded-card border border-line bg-panel">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel2/60 px-4 py-3 sm:px-5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  Install from source
                </span>
                <div className="flex items-center gap-3">
                  <span
                    role="status"
                    aria-live="polite"
                    className={`font-mono text-[10px] uppercase tracking-[0.12em] ${
                      status === 'failed' ? 'text-danger' : 'text-accent2'
                    }`}
                  >
                    {status === 'idle' ? '' : status === 'copied' ? 'Copied to clipboard' : 'Copy failed'}
                  </span>
                  <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" />
                      <path d="M8 4V2.5A1.5 1.5 0 0 0 6.5 1h-4A1.5 1.5 0 0 0 1 2.5v4A1.5 1.5 0 0 0 2.5 8H4" stroke="currentColor" />
                    </svg>
                    {label}
                  </button>
                </div>
              </div>

              <ol className="divide-y divide-line font-mono text-[12.5px] leading-relaxed sm:text-[13.5px]">
                {INSTALL_COMMANDS.split('\n').map((command, index) => (
                  <li key={command} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                    <span aria-hidden="true" className="select-none pt-px text-muted">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <code className="min-w-0 break-all text-cream/90">
                      <span aria-hidden="true" className="mr-2 text-accent">
                        $
                      </span>
                      {command}
                    </code>
                  </li>
                ))}
              </ol>

              <p className="border-t border-line px-4 py-3 font-mono text-[10.5px] leading-relaxed text-muted sm:px-5">
                Node 24+ is required. The app listens on{' '}
                <code className="text-cream/90">127.0.0.1:7777</code>; agent CLIs are installed and
                authenticated separately.
              </p>
            </div>
          </div>

          <div data-reveal className="lg:col-span-4">
            <div className="overflow-hidden rounded-card border border-line bg-panel">
              <picture>
                <source
                  type="image/avif"
                  srcSet={`${asset('images/detail-keyboard-800.avif')} 800w, ${asset('images/detail-keyboard-1200.avif')} 1200w`}
                  sizes="(min-width: 1024px) 30vw, 92vw"
                />
                <source
                  type="image/webp"
                  srcSet={`${asset('images/detail-keyboard-800.webp')} 800w, ${asset('images/detail-keyboard-1200.webp')} 1200w`}
                  sizes="(min-width: 1024px) 30vw, 92vw"
                />
                <img
                  src={asset('images/detail-keyboard-1200.jpg')}
                  srcSet={`${asset('images/detail-keyboard-800.jpg')} 800w, ${asset('images/detail-keyboard-1200.jpg')} 1200w`}
                  sizes="(min-width: 1024px) 30vw, 92vw"
                  width="1200"
                  height="1514"
                  loading="lazy"
                  decoding="async"
                  alt="Close-up of a mechanical keyboard with one keycap removed, revealing an orange switch beside a metal volume dial."
                  className="aspect-[4/3] w-full object-cover opacity-85"
                />
              </picture>

              <dl className="divide-y divide-line text-[13px]">
                {[
                  ['Runtime', 'Node 24 and npm'],
                  ['Platforms', 'Windows tested · macOS/Linux Node 24'],
                  ['Agents', 'Your installed CLIs'],
                ].map(([term, detail]) => (
                  <div key={term} className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                      {term}
                    </dt>
                    <dd className="text-right text-cream/90">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
