import { useEffect, useRef } from 'react'
import { animate, createScope, createTimeline, stagger, svg } from 'animejs'
import { HERO_PLAN } from '../data/content.js'
import { asset } from '../lib/asset.js'
import { prefersReducedMotion } from '../lib/motion.js'
import Count from './Count.jsx'

const SRC_WIDTHS = [
  { avif: asset('images/hero-workspace-800.avif'), webp: asset('images/hero-workspace-800.webp'), w: 800 },
  { avif: asset('images/hero-workspace-1200.avif'), webp: asset('images/hero-workspace-1200.webp'), w: 1200 },
  { avif: asset('images/hero-workspace-1600.avif'), webp: asset('images/hero-workspace-1600.webp'), w: 1600 },
]

const AVIF_SRC_SET = SRC_WIDTHS.map(({ avif, w }) => `${avif} ${w}w`).join(', ')
const WEBP_SRC_SET = SRC_WIDTHS.map(({ webp, w }) => `${webp} ${w}w`).join(', ')
const JPG_SRC_SET = SRC_WIDTHS.map(({ w }) => `${asset(`images/hero-workspace-${w}.jpg`)} ${w}w`).join(', ')
const SIZES = '100vw'

const CONNECTORS = [
  'M14 50 C 28 50, 30 18, 42 18',
  'M14 50 H42',
  'M14 50 C 28 50, 30 82, 42 82',
  'M58 18 C 70 18, 72 50, 86 50',
  'M58 50 H86',
  'M58 82 C 70 82, 72 50, 86 50',
]

export default function Hero() {
  const rootRef = useRef(null)
  const parallaxRef = useRef(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    const scope = createScope({ root })

    scope.add(() => {
      if (prefersReducedMotion()) return

      const animated = root.querySelectorAll(
        '.hero-img, .hero-line > span, .hero-fade, .hero-card',
      )
      animated.forEach((element) => {
        element.style.willChange = 'transform, opacity'
      })

      const finish = () => {
        animated.forEach((element) => {
          element.style.willChange = ''
        })
      }

      const timeline = createTimeline({
        defaults: { ease: 'outExpo' },
        onComplete: finish,
      })

      timeline
        .add(
          '.hero-img',
          { scale: [1.04, 1], duration: 1500, ease: 'outQuint' },
          0,
        )
        .add(
          '.hero-line > span',
          { y: ['110%', '0%'], duration: 900, delay: stagger(90) },
          120,
        )
        .add(
          '.hero-fade',
          { opacity: [0, 1], y: [16, 0], duration: 700, delay: stagger(60) },
          420,
        )
        .add(
          '.hero-card',
          {
            opacity: [0, 1],
            y: [14, 0],
            scale: [0.97, 1],
            duration: 900,
            ease: 'outBack(1.35)',
          },
          720,
        )

      const connectors = root.querySelectorAll('.hero-connector')
      if (connectors.length) {
        const drawables = svg.createDrawable(connectors)
        animate(drawables, {
          draw: ['0 0', '0 1'],
          duration: 900,
          delay: stagger(90),
          ease: 'inOutQuad',
        })
      }

      return finish
    })

    return () => scope.revert()
  }, [])

  useEffect(() => {
    if (prefersReducedMotion()) return undefined

    const element = parallaxRef.current
    let frame = 0

    const update = () => {
      frame = 0
      const offset = Math.min(10, Math.max(0, window.scrollY * 0.04))
      if (element) element.style.transform = `translate3d(0, ${offset}px, 0)`
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      if (element) element.style.transform = ''
    }
  }, [])

  return (
    <section ref={rootRef} className="relative isolate overflow-hidden pt-[68px]">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div ref={parallaxRef} className="absolute -inset-y-6 inset-x-0">
          <picture>
            <source type="image/avif" srcSet={AVIF_SRC_SET} sizes={SIZES} />
            <source type="image/webp" srcSet={WEBP_SRC_SET} sizes={SIZES} />
            <img
              src={asset('images/hero-workspace-1200.jpg')}
              srcSet={JPG_SRC_SET}
              sizes={SIZES}
              width="1200"
              height="1500"
              alt="A laptop glowing on a dark desk beside a phone, with a window at the right."
              fetchPriority="high"
              decoding="async"
              className="hero-img h-full w-full object-cover object-center opacity-75"
            />
          </picture>
        </div>

        <div className="absolute inset-0 bg-gradient-to-b from-ink/90 via-ink/80 to-ink lg:bg-gradient-to-r lg:from-ink lg:via-ink/80 lg:to-ink/25" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
        <div className="glow glow-amber -left-48 top-8 h-[560px] w-[560px]" />
        <div className="glow glow-green right-[-12%] top-[18%] h-[420px] w-[420px] opacity-70" />
      </div>

      <div className="relative mx-auto grid max-w-content grid-cols-1 gap-y-14 px-gutter pb-20 pt-14 lg:grid-cols-12 lg:gap-x-12 lg:pb-28 lg:pt-24">
        <div className="lg:col-span-7 lg:pr-6">
          <p className="eyebrow hero-fade">
            <span aria-hidden="true" className="h-px w-7 shrink-0 bg-accent/70" />
            <span>Local-first agent orchestration</span>
          </p>

          <h1 className="mt-6 font-display text-[clamp(3.1rem,7.4vw,5.9rem)] leading-[0.92] tracking-[-0.025em] text-cream">
            <span className="hero-line block overflow-hidden">
              <span className="block">Your agents.</span>
            </span>
            <span className="hero-line mt-1 block overflow-hidden">
              <span className="block">
                One relay<span className="text-accent">.</span>
              </span>
            </span>
          </h1>

          <p className="hero-fade mt-7 max-w-[47ch] text-pretty text-[16.5px] leading-[1.75] text-muted sm:text-[17.5px]">
            Plan a task once. Relay routes each step to the CLI agents and API models you already
            trust, then brings the work back into one local workspace.
          </p>

          <div className="hero-fade mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a href="#install" className="btn btn-primary">
              Install locally
              <span aria-hidden="true" className="text-[0.95em]">
                ↓
              </span>
            </a>
            <a href="#how-it-works" className="btn btn-secondary">
              See how it works
            </a>
          </div>

          <p className="hero-fade mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Runs on 127.0.0.1 <span aria-hidden="true">·</span> Your keys stay on your machine
          </p>

          <dl className="hero-fade mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {[
              ['Runtime', 'Node 24'],
              ['Network exposure', 'Loopback only'],
              ['Account required', 'No account'],
            ].map(([term, value]) => (
              <div key={term} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                <dt className="sr-only">{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:col-span-5 lg:flex lg:items-center lg:justify-end">
          <div className="hero-card relative w-full max-w-[27rem] overflow-hidden rounded-card border border-line bg-ink/70 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-cream/70">
              <span>Run / local</span>
              <span className="flex items-center gap-1.5 text-accent2">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent2" />
                <Count to={HERO_PLAN.count} /> agents active
              </span>
            </div>

            <div className="relative p-4 sm:p-5">
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {CONNECTORS.map((path) => (
                  <path
                    key={path}
                    className="hero-connector"
                    d={path}
                    fill="none"
                    stroke="rgba(244,162,97,0.42)"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              <div className="relative grid grid-cols-[auto_1fr_auto] items-center gap-3">
                <span className="rounded-md border border-line bg-ink/90 px-2.5 py-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-cream/80">
                  Plan
                </span>

                <ul className="space-y-2">
                  {HERO_PLAN.agents.map((agent, index) => (
                    <li
                      key={agent}
                      className="flex items-center justify-between gap-2 rounded-md border border-line bg-panel/90 px-2.5 py-2"
                    >
                      <span className="truncate text-[12.5px] font-medium text-cream">{agent}</span>
                      <span
                        className={`font-mono text-[9px] uppercase tracking-[0.12em] ${
                          index === 0 ? 'text-accent2' : index === 1 ? 'text-accent' : 'text-muted'
                        }`}
                      >
                        {index === 0 ? 'done' : index === 1 ? 'running' : 'queued'}
                      </span>
                    </li>
                  ))}
                </ul>

                <span className="rounded-md border border-line bg-ink/90 px-2.5 py-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-cream/80">
                  Review
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              <span>3 lanes</span>
              <span className="text-accent2">done</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
