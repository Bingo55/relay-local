import { useRef } from 'react'
import { animate } from 'animejs'
import { prefersReducedMotion, useAnimeScope } from '../lib/motion.js'

/**
 * Small real-value counter. The final value is exposed to assistive technology
 * immediately; only the visible glyphs count up.
 */
export default function Count({ to, className = '' }) {
  const valueRef = useRef(null)
  const motionOn =
    typeof document !== 'undefined' && document.documentElement.dataset.motion === 'on'
  const initial = motionOn ? '0' : String(to)

  useAnimeScope(valueRef, (root) => {
    if (prefersReducedMotion()) {
      if (root) root.textContent = String(to)
      return undefined
    }

    const state = { value: 0 }
    if (root) root.textContent = '0'

    animate(state, {
      value: to,
      duration: 900,
      ease: 'outExpo',
      onUpdate: () => {
        if (valueRef.current) valueRef.current.textContent = String(Math.round(state.value))
      },
      onComplete: () => {
        if (valueRef.current) valueRef.current.textContent = String(to)
      },
    })

    return undefined
  })

  return (
    <span className={className}>
      <span ref={valueRef} aria-hidden="true">
        {initial}
      </span>
      <span className="sr-only">{to}</span>
    </span>
  )
}
