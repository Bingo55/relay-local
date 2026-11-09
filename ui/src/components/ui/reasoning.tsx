"use client"

import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import React, { createContext, useContext, useEffect, useId, useState } from "react"
import { Markdown } from "./markdown"

type ReasoningContextType = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  contentId: string
}

const ReasoningContext = createContext<ReasoningContextType | undefined>(undefined)

function useReasoningContext() {
  const context = useContext(ReasoningContext)
  if (!context) throw new Error("Reasoning components must be used within Reasoning")
  return context
}

export type ReasoningProps = {
  children: React.ReactNode
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isStreaming?: boolean
}

function Reasoning({ children, className, open, onOpenChange, isStreaming }: ReasoningProps) {
  const [internalOpen, setInternalOpen] = useState(!!isStreaming)
  useEffect(() => { if (open === undefined) setInternalOpen(!!isStreaming) }, [isStreaming, open])
  const contentId = useId()
  function handleOpenChange(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
  return (
    <ReasoningContext.Provider value={{ isOpen: open ?? internalOpen, onOpenChange: handleOpenChange, contentId }}>
      <div className={className}>{children}</div>
    </ReasoningContext.Provider>
  )
}

export type ReasoningTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement>

function ReasoningTrigger({ children, className, onClick, ...props }: ReasoningTriggerProps) {
  const { isOpen, onOpenChange, contentId } = useReasoningContext()
  return (
    <button
      {...props}
      type="button"
      className={cn("flex min-h-11 min-w-11 items-center gap-2 rounded-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      aria-expanded={isOpen}
      aria-controls={contentId}
      onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) onOpenChange(!isOpen) }}
    >
      <span>{children}</span>
      <ChevronDownIcon aria-hidden="true" className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
    </button>
  )
}

export type ReasoningContentProps = {
  markdown?: boolean
  contentClassName?: string
} & React.HTMLAttributes<HTMLDivElement>

function ReasoningContent({ children, className, contentClassName, markdown = false, ...props }: ReasoningContentProps) {
  const { isOpen, contentId } = useReasoningContext()
  return (
    <div {...props} id={contentId} hidden={!isOpen} className={className}>
      <div className={cn("text-sm text-muted-foreground", contentClassName)}>
        {markdown ? <Markdown>{String(children ?? "")}</Markdown> : children}
      </div>
    </div>
  )
}

export { Reasoning, ReasoningTrigger, ReasoningContent }
