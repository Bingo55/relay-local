import { useRef } from 'react'
import { animate, stagger, svg } from 'animejs'
import {
  ORCHESTRATION_LANES,
  ORCHESTRATION_RESULT,
  ORCHESTRATION_TASK,
} from '../data/content.js'
import { prefersReducedMotion, setupReveal, useAnimeScope } from '../lib/motion.js'
import Count from './Count.jsx'
import SectionLabel from './SectionLabel.jsx'

const STATE_TONE = {
  Done: 'text-accent2',
  Running: 'text-accent',
  Queued: 'text-muted',
}

const STATE_DOT = {
  Done: 'bg-accent2',
  Running: 'bg-accent',
  Queued: 'bg-muted/60',
}

const ROUTES = [
  'M14 50 C 28 50, 30 18, 42 18 H58 C 70 18, 72 50, 86 50',
  'M14 50 H86',
  'M14 50 C 28 50, 30 82, 42 82 H58 C 70 82, 72 50, 86 50',
]

export default function Orchestration() {
  const rootRef = useRef(null)

  useAnimeScope(rootRef, (root) => {
    const cleanupReveal = setupReveal(root, {
      selector: '[data-reveal]',
      staggerMs: 60,
    })

    if (prefersReducedMotion()) return cleanupReveal

    const paths = Array.from(root.querySelectorAll('.orch-route'))
    if (paths.length) {
      const drawables = svg.createDrawable(paths)
      animate(drawables, {
        draw: ['0 0', '0 1'],
        duration: 1200,
        delay: stagger(110),
        ease: 'inOutQuad',
      })
    }

    const pulses = Array.from(root.querySelectorAll('.orch-pulse'))
    pulses.forEach((pulse, index) => {
      const path = paths[index % paths.length]
      if (!path) return
      const motion = svg.createMotionPath(path)
      animate(pulse, {
        translateX: motion.translateX,
        translateY: motion.translateY,
        opacity: [0, 1, 1, 0],
        duration: 1600,
        delay: 800 + index * 180,
        ease: 'inOutQuad',
      })
    })

    return cleanupReveal
  })

  return (
    <section id="product" ref={rootRef} className="relative border-t border-line">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="glow glow-green -right-32 top-24 h-[420px] w-[420px]" />
      </div>

      <div className="relative mx-auto max-w-content px-gutter py-section">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <div data-reveal>
              <SectionLabel>One prompt. Many hands.</SectionLabel>

              <h2 className="mt-6 text-balance font-display text-[clamp(2.4rem,4.4vw,3.6rem)] leading-[1.02] tracking-[-0.02em] text-cream">
                Stop babysitting tabs.
              </h2>

              <p className="mt-6 max-w-[48ch] text-pretty text-[15.5px] leading-[1.8] text-muted">
                Relay turns a goal into a plan, assigns each step to the agent best suited for it,
                and keeps every output in one thread. You stay in control of the model, the folder,
                and the final call.
              </p>

              <a
                href="#how-it-works"
                className="link-sweep mt-8 inline-flex items-center gap-2 text-[14.5px] text-cream"
              >
                How a run is assembled
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div
              data-reveal
              aria-hidden="true"
              className="panel overflow-hidden bg-panel/70"
            >
              <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="truncate">Run / checkout-flow</span>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  <Count to={ORCHESTRATION_LANES.length} /> lanes
                </span>
              </div>

              <div className="relative px-4 py-6 sm:px-6 sm:py-8">
                <svg
                  className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {ROUTES.map((route) => (
                    <path
                      key={route}
                      className="orch-route"
                      d={route}
                      fill="none"
                      stroke="rgba(244,162,97,0.42)"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {ROUTES.map((route) => (
                    <circle
                      key={`pulse-${route}`}
                      className="orch-pulse"
                      r="1.2"
                      fill="#F4A261"
                      opacity="0"
                    />
                  ))}
                </svg>

                <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.15fr_1fr] sm:items-center sm:gap-4">
                  <div className="rounded-card border border-line bg-ink/80 p-4">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted">
                      {ORCHESTRATION_TASK.label}
                    </span>
                    <p className="mt-2 text-[14.5px] font-medium leading-snug text-cream">
                      {ORCHESTRATION_TASK.title}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      {ORCHESTRATION_TASK.detail}
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    {ORCHESTRATION_LANES.map((lane) => (
                      <div
                        key={lane.agent}
                        className="rounded-card border border-line bg-panel/90 px-3.5 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[lane.state]}`} />
                            <span className="truncate text-[12.5px] font-medium text-cream">
                              {lane.agent}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] ${STATE_TONE[lane.state]}`}
                          >
                            {lane.state}
                          </span>
                        </div>
                        <p className="mt-1.5 truncate text-[12px] text-cream/80">{lane.task}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-card border border-line bg-ink/80 p-4">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted">
                      {ORCHESTRATION_RESULT.label}
                    </span>
                    <p className="mt-2 text-[14.5px] font-medium leading-snug text-cream">
                      {ORCHESTRATION_RESULT.title}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      {ORCHESTRATION_RESULT.detail}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-ink/40 px-4 py-3 sm:px-5">
                <span className="font-mono text-[10.5px] text-muted">
                  transcript · model · git diff
                </span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent2">
                  Kept per lane
                </span>
              </div>
            </div>

            <ol className="sr-only">
              <li>{ORCHESTRATION_TASK.label}: {ORCHESTRATION_TASK.title}. {ORCHESTRATION_TASK.detail}.</li>
              {ORCHESTRATION_LANES.map((lane) => (
                <li key={lane.agent}>
                  {lane.agent}: {lane.task}. Status: {lane.state}. {lane.detail}.
                </li>
              ))}
              <li>
                {ORCHESTRATION_RESULT.label}: {ORCHESTRATION_RESULT.title}.{' '}
                {ORCHESTRATION_RESULT.detail}.
              </li>
            </ol>

            <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
              Fig. 02 — one objective, three lanes
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
