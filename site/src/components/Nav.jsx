import { useEffect, useRef, useState } from 'react'
import { animate } from 'animejs'
import { NAV_LINKS } from '../data/content.js'
import { prefersReducedMotion, useAnimeScope } from '../lib/motion.js'
import { Wordmark } from './Brand.jsx'

const FOCUSABLE = 'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState('')
  const [open, setOpen] = useState(false)
  const headerRef = useRef(null)
  const toggleRef = useRef(null)
  const panelRef = useRef(null)

  useAnimeScope(headerRef, (root) => {
    if (prefersReducedMotion()) return undefined

    root.style.willChange = 'transform, opacity'
    animate(root, {
      y: [-12, 0],
      opacity: [0, 1],
      duration: 600,
      ease: 'outExpo',
      onComplete: () => {
        root.style.willChange = ''
      },
    })

    return () => {
      root.style.willChange = ''
    }
  })

  useEffect(() => {
    let frame = 0

    const read = () => {
      frame = 0
      setScrolled(window.scrollY > 40)

      const marker = window.scrollY + 140
      let next = ''
      for (const link of NAV_LINKS) {
        const element = document.getElementById(link.id)
        if (!element) continue
        const top = element.getBoundingClientRect().top + window.scrollY
        if (top <= marker) next = link.id
      }
      setActive(next)
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
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined

    const toggle = toggleRef.current
    const panel = panelRef.current

    const focusables = () =>
      [toggle, ...Array.from(panel?.querySelectorAll(FOCUSABLE) ?? [])].filter(Boolean)

    const focusFrame = requestAnimationFrame(() => {
      const firstLink = panel?.querySelector('a[href]')
      firstLink?.focus()
    })

    const closeAndReturn = () => {
      setOpen(false)
      requestAnimationFrame(() => toggleRef.current?.focus())
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAndReturn()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const onPointerDown = (event) => {
      if (headerRef.current && !headerRef.current.contains(event.target)) {
        closeAndReturn()
      }
    }

    const onResize = () => {
      if (window.matchMedia('(min-width: 768px)').matches) setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const solid = scrolled || open

  const closeMenu = () => {
    setOpen(false)
    requestAnimationFrame(() => toggleRef.current?.focus())
  }

  return (
    <header
      ref={headerRef}
      data-nav
      className="fixed inset-x-0 top-0 z-50"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 border-b border-line bg-ink/90 backdrop-blur-xl transition-opacity duration-300 ${
          solid ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div className="relative mx-auto flex h-[68px] max-w-content items-center justify-between px-gutter">
        <Wordmark />

        <nav aria-label="Primary" className="hidden items-center md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = active === link.id
            return (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={`nav-link ${isActive ? 'nav-link-active' : ''}`}
                aria-current={isActive ? 'location' : undefined}
              >
                {link.label}
              </a>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a href="#install" className="btn btn-primary hidden !px-5 !py-2.5 !text-sm sm:inline-flex">
            Install
          </a>
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-cream md:hidden"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      <div
        id="mobile-menu"
        ref={panelRef}
        hidden={!open}
        className="border-t border-line bg-ink/95 backdrop-blur-xl md:hidden"
      >
        <nav aria-label="Mobile primary" className="mx-auto max-w-content px-gutter py-4">
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.id}>
                <a
                  href={`#${link.id}`}
                  onClick={closeMenu}
                  className={`flex items-center justify-between border-b border-line py-4 text-[16px] ${
                    active === link.id ? 'text-accent' : 'text-cream'
                  }`}
                  aria-current={active === link.id ? 'location' : undefined}
                >
                  {link.label}
                  <span aria-hidden="true" className="font-mono text-sm text-muted">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <a
            href="#install"
            onClick={closeMenu}
            className="btn btn-primary mt-4 w-full !text-[15px]"
          >
            Install locally
          </a>
        </nav>
      </div>
    </header>
  )
}
