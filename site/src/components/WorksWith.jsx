import { useEffect, useRef } from 'react'
import { AGENTS } from '../data/content.js'

export default function WorksWith() {
  const marqueeRef = useRef(null)

  useEffect(() => {
    const marquee = marqueeRef.current
    if (!marquee) return undefined

    const setPaused = (paused) => {
      marquee.dataset.paused = paused ? 'true' : 'false'
    }

    const onVisibility = () => setPaused(document.hidden)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        setPaused(document.hidden || !entry.isIntersecting)
      },
      { threshold: 0 },
    )

    document.addEventListener('visibilitychange', onVisibility)
    observer.observe(marquee)
    onVisibility()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
    }
  }, [])

  return (
    <section
      aria-labelledby="works-with-heading"
      className="border-y border-line bg-panel/40 py-6 sm:py-7"
    >
      <div className="mx-auto max-w-content px-gutter">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <h2
            id="works-with-heading"
            className="shrink-0 font-mono text-[10.5px] uppercase leading-none tracking-[0.18em] text-muted"
          >
            Works with
          </h2>

          <div ref={marqueeRef} className="marquee marquee-mask relative w-full overflow-hidden">
            <div className="marquee-track flex w-max items-center">
              {[0, 1].map((copy) => (
                <ul
                  key={copy}
                  aria-hidden={copy === 1 ? 'true' : undefined}
                  className="flex shrink-0 items-center"
                >
                  {AGENTS.map((agent) => (
                    <li
                      key={`${copy}-${agent}`}
                      className="flex items-center whitespace-nowrap font-display text-[1.35rem] leading-none text-cream/75 sm:text-[1.5rem]"
                    >
                      {agent}
                      <span aria-hidden="true" className="mx-6 h-1 w-1 rounded-full bg-accent/50 sm:mx-8" />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-4 max-w-[72ch] font-mono text-[10.5px] leading-relaxed tracking-[0.02em] text-muted sm:mt-5">
          Works with the agent CLIs you already use. Agent availability depends on your OS and
          installed tools.
        </p>
      </div>
    </section>
  )
}
