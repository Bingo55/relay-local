import { useEffect } from 'react'
import { animate, createScope, stagger } from 'animejs'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function asArray(value) {
  if (!value) return []
  if (value.nodeType) return [value]
  if (typeof value.length === 'number') return Array.from(value)
  return [value]
}

export function markWillChange(elements, value = 'transform, opacity') {
  const list = asArray(elements)
  list.forEach((element) => {
    if (element?.style) element.style.willChange = value
  })
  return () => {
    list.forEach((element) => {
      if (element?.style) element.style.willChange = ''
    })
  }
}

function clearInlineState(elements) {
  elements.forEach((element) => {
    element.style.opacity = ''
    element.style.transform = ''
    element.style.willChange = ''
  })
}

/**
 * Reveal a group of elements once when the root enters the viewport.
 * Returns a cleanup function; safe to call inside an anime.js scope.
 */
export function setupReveal(
  root,
  { selector = '[data-reveal]', staggerMs = 60, threshold = 0.15 } = {},
) {
  if (!root) return () => {}

  const elements = Array.from(root.querySelectorAll(selector))
  if (!elements.length) return () => {}

  if (prefersReducedMotion()) {
    elements.forEach((element) => element.classList.add('is-revealed'))
    return () => {}
  }

  let animation
  let revealed = false

  const reveal = () => {
    if (revealed) return
    revealed = true
    elements.forEach((element) => {
      element.classList.add('is-revealed')
      // Set the first frame explicitly so adding the class cannot flash the
      // final state for one frame before anime.js takes over.
      element.style.opacity = '0'
      element.style.transform = 'translate3d(0, 22px, 0)'
    })
    const clearWillChange = markWillChange(elements)
    animation = animate(elements, {
      opacity: [0, 1],
      y: [22, 0],
      duration: 700,
      delay: stagger(staggerMs),
      ease: 'outExpo',
      onComplete: () => {
        clearWillChange()
        clearInlineState(elements)
      },
    })
  }

  // Without IntersectionObserver there is no way to know when a section enters
  // the viewport, so show everything at once instead of leaving it hidden.
  if (typeof IntersectionObserver !== 'function') {
    reveal()
    return () => animation?.revert()
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        reveal()
      }
    },
    { threshold, rootMargin: '0px 0px -8% 0px' },
  )

  elements.forEach((element) => observer.observe(element))

  return () => {
    observer.disconnect()
    animation?.revert()
  }
}

/**
 * One anime.js scope per component. The setup callback runs once and may
 * return a cleanup function. scope.revert() removes every animation and inline
 * style created inside the scope on unmount.
 */
export function useAnimeScope(rootRef, setup) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    const scope = createScope({ root })
    let cleanup = () => {}

    scope.add(() => {
      const result = setup(root, scope)
      if (typeof result === 'function') cleanup = result
    })

    return () => {
      cleanup()
      scope.revert()
    }
    // The setup callback is intentionally mount-only; each component owns one scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function useReveal(rootRef, options = {}) {
  useAnimeScope(rootRef, (root) => setupReveal(root, options))
}
