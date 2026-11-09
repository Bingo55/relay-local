"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import React, { useEffect, useState } from "react"

export type CodeBlockProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div className={cn("code-block not-prose min-w-0 overflow-clip text-foreground", className)} {...props}>
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
} & React.HTMLAttributes<HTMLDivElement>

function CodeBlockCode({ code, language, theme: _theme, className, ...props }: CodeBlockCodeProps) {
  return (
    <div className={cn("w-full overflow-x-auto bg-muted text-sm", className)} {...props}>
      <pre className="m-0 p-4 font-mono"><code data-language={language}>{code}</code></pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({ children, className, ...props }: CodeBlockGroupProps) {
  return <div className={cn("code-block-header flex items-center justify-between gap-2", className)} {...props}>{children}</div>
}

function CodeBlockCopyButton({ code }: { code: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle")
  useEffect(() => setStatus("idle"), [code])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setStatus("copied")
    } catch {
      setStatus("error")
    }
  }

  const label = status === "copied" ? "Copied" : status === "error" ? "Couldn't copy" : "Copy code"
  return (
    <Button type="button" variant="ghost" size="sm" aria-label={label} onClick={copy}>
      <span role="status" aria-live="polite">{label}</span>
    </Button>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock, CodeBlockCopyButton }
