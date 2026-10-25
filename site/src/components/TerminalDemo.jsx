import { useEffect, useRef, useState } from 'react'
import { animate } from 'animejs'
import { TERMINAL_COMMAND, TERMINAL_PLAN } from '../data/content.js'
import { prefersReducedMotion, useReveal } from '../lib/motion.js'
import SectionLabel from './SectionLabel.jsx'

export default function TerminalDemo() {
  const rootRef = useRef(null)
  const startedRef = useRef(false)
  const animationRef = useRef(null)
  const [typed, setTyped] = useState('')
  const [phase, setPhase] = useState('idle')
  const [runId, setRunId] = useState(0)

  useReveal(rootRef)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    if (prefersReducedMotion()) {
      setTyped(TERMINAL_COMMAND)
      setPhase('done')
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        if (startedRef.current) return
        startedRef.current = true
        setRunId(1)
      },
      { threshold: 0.3 },
    )

    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!runId) return undefined

    animationRef.current?.revert()
    setTyped('')
    setPhase('typing')

    if (prefersReducedMotion()) {
      setTyped(TERMINAL_COMMAND)
      setPhase('done')
      return undefined
    }

    const state = { chars: 0 }
    const animation = animate(state, {
      chars: TERMINAL_COMMAND.length,
      duration: TERMINAL_COMMAND.length * 26,
      ease: 'linear',
      onUpdate: () => {
        setTyped(TERMINAL_COMMAND.slice(0, Math.round(state.chars)))
      },
      onComplete: () => {
        setTyped(TERMINAL_COMMAND)
        setPhase('plan')
      },
    })

    animationRef.current = animation

    return () => {
      animation.revert()
      if (animationRef.current === animation) animationRef.current = null
    }
  }, [runId])

  const replay = () => {
    startedRef.current = true
    setRunId((value) => value + 1)
  }

  const planVisible = phase === 'plan' || phase === 'done'

  return (
    <section ref={rootRef} aria-labelledby="demo-heading" className="relative border-t border-line">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="glow glow-amber left-[8%] top-10 h-[360px] w-[360px] opacity-70" />
      </div>

      <div className="relative mx-auto max-w-content px-gutter py-section">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end lg:gap-16">
          <div data-reveal className="lg:col-span-7">
            <SectionLabel>A run, in full</SectionLabel>
            <h2
              id="demo-heading"
              className="mt-6 text-balance font-display text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-cream"
            >
              Nothing hidden behind a spinner.
            </h2>
          </div>
          <p data-reveal className="max-w-[42ch] text-[15px] leading-[1.8] text-muted lg:col-span-5">
            Every lane reports its agent, its task, and what it changed. When the run ends, the
            transcript and the diff stay attached to the session.
          </p>
        </div>

        <div
          data-reveal
          data-phase={phase}
          className="mt-10 overflow-hidden rounded-card border border-line bg-panel/80 shadow-[0_40px_120px_-60px_rgba(0,0,0,0.9)] lg:mt-12"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel2/70 px-4 py-3">
            <div className="flex items-center gap-2" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="h-2 w-2 rounded-full bg-accent/60" />
            </div>
            <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
              relay — session 7f2c
            </span>
            <div className="flex items-center gap-3">
              <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted sm:block">
                local
              </span>
              <button
                type="button"
                onClick={replay}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cream"
                aria-label="Replay terminal demo"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M2.2 4.2A4.2 4.2 0 1 1 1.8 6"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                  <path d="M1 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Replay
              </button>
            </div>
          </div>

          <div className="overflow-x-auto px-4 py-5 sm:px-6 sm:py-7">
            <div className="min-w-[264px] font-mono text-[11.5px] leading-[1.9] sm:text-[12.5px]">
              <div aria-hidden="true">
                <p className="min-h-[3.8em] whitespace-pre-wrap break-words sm:min-h-[1.9em]">
                  <span className="text-accent">$</span>{' '}
                  <span className="text-cream">{typed}</span>
                  <span
                    className={`terminal-cursor ml-1 inline-block h-[0.95em] w-[0.5em] translate-y-[0.1em] bg-accent/80 ${
                      phase === 'typing' ? 'is-typing' : ''
                    }`}
                  />
                </p>

                <div className={`terminal-plan mt-4 ${planVisible ? 'is-visible' : ''}`}>
                  <p className="text-accent2">→ plan written · editable</p>
                  <p className="mt-2 text-cream/90">
                    plan <span className="text-muted"> </span>
                    <span className="text-cream">{TERMINAL_PLAN.route}</span>
                  </p>

                  <ol className="mt-4 space-y-2" aria-label="Plan steps">
                    {TERMINAL_PLAN.rows.map((row) => (
                      <li
                        key={row.n}
                        className="grid grid-cols-[2.5rem_1fr] gap-x-3 gap-y-0.5 border-l border-line pl-3"
                      >
                        <span className="text-muted">{row.n}</span>
                        <span className="min-w-0 break-words text-cream/90">{row.task}</span>
                        <span aria-hidden="true" />
                        <span className="text-[10.5px] text-muted">{row.agent}</span>
                      </li>
                    ))}
                  </ol>

                  <p className="mt-4 text-muted">{TERMINAL_PLAN.prompt}</p>
                </div>
              </div>

              <pre className="sr-only">
{`$ ${TERMINAL_COMMAND}

→ plan written · editable
plan  ${TERMINAL_PLAN.route}
${TERMINAL_PLAN.rows.map((row) => `${row.n}  ${row.task}  ${row.agent}`).join('\n')}

${TERMINAL_PLAN.prompt}`}
              </pre>
            </div>
          </div>
        </div>

        <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
          Illustrative session — static in this build, not a live connection.
        </p>
      </div>
    </section>
  )
}
