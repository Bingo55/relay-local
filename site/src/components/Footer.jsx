import { useRef } from 'react'
import { NAV_LINKS } from '../data/content.js'
import { asset } from '../lib/asset.js'
import { useReveal } from '../lib/motion.js'
import { Wordmark } from './Brand.jsx'

export default function Footer() {
  const rootRef = useRef(null)
  useReveal(rootRef)

  return (
    <footer ref={rootRef} className="border-t border-line bg-panel/30">
      <div className="mx-auto max-w-content px-gutter py-14 lg:py-16">
        <h2 className="sr-only">Footer</h2>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <div data-reveal className="lg:col-span-6">
            <Wordmark />
            <p className="mt-5 max-w-[38ch] text-[14.5px] leading-[1.8] text-muted">
              Local-first agent orchestration. A local workspace for planning, routing, and running
              coding agents. Your keys, your models, your project folder.
            </p>
            <a href="#install" className="btn btn-primary mt-7">
              Install locally
              <span aria-hidden="true" className="text-[0.95em]">
                ↓
              </span>
            </a>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 lg:col-span-6">
            <nav data-reveal aria-labelledby="footer-sections">
              <h3
                id="footer-sections"
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted"
              >
                Sections
              </h3>
              <ul className="mt-4 space-y-2.5">
                {NAV_LINKS.map((link) => (
                  <li key={link.id}>
                    <a
                      href={`#${link.id}`}
                      className="text-[14px] text-cream/80 hover:text-cream"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav data-reveal aria-labelledby="footer-notes">
              <h3
                id="footer-notes"
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted"
              >
                Notes
              </h3>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <a
                    href={asset('images/CREDITS.md')}
                    className="text-[14px] text-cream/80 hover:text-cream"
                  >
                    Image credits
                  </a>
                </li>
                <li>
                  <a
                    href={asset('fonts/NOTICE.md')}
                    className="text-[14px] text-cream/80 hover:text-cream"
                  >
                    Font licenses
                  </a>
                </li>
                <li>
                  <a
                    href="#security"
                    className="text-[14px] text-cream/80 hover:text-cream"
                  >
                    Security notes
                  </a>
                </li>
              </ul>
            </nav>

            <div data-reveal>
              <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Source
              </h3>
              <a
                href="https://github.com/Nepoleon/relay-local"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-[13px] leading-[1.7] text-cream/80 hover:text-cream"
              >
                GitHub repository
              </a>
              <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent">
                Source · MIT
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            © 2026 Relay
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            React · Vite · Tailwind · anime.js
          </p>
        </div>
      </div>
    </footer>
  )
}
