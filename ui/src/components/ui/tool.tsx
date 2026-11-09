import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ChevronDown, Loader2 } from "lucide-react"
import { useState, type ReactNode } from "react"

export type ToolPart = {
  type: string
  state: "input-streaming" | "input-available" | "output-available" | "output-error"
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  toolCallId?: string
  errorText?: string
}

export type ToolProps = {
  toolPart: ToolPart
  defaultOpen?: boolean
  className?: string
  label?: ReactNode
  statusLabel?: string
  meta?: ReactNode
}

const statusLabels = {
  "input-streaming": "working…",
  "input-available": "ready",
  "output-available": "done",
  "output-error": "didn't finish",
}

function Tool({ toolPart, defaultOpen = false, className, label, statusLabel, meta }: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const { state, input, output, toolCallId, errorText } = toolPart

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={cn("min-w-0 border-b border-border text-foreground", className)}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="min-h-11 w-full justify-between whitespace-normal rounded-none px-0 text-left font-normal">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {state === "input-streaming" && <Loader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />}
            <span className="text-sm font-medium">{label ?? toolPart.type}</span>
            <span className={cn("text-sm text-muted-foreground", state === "output-error" && "text-destructive")}>{statusLabel ?? statusLabels[state]}</span>
            {meta && <span className="text-sm text-muted-foreground">{meta}</span>}
          </span>
          <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pb-3">
        {input && Object.keys(input).length > 0 && (
          <section>
            <h4 className="mb-1 text-sm text-muted-foreground">Input</h4>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm"><code>{JSON.stringify(input, null, 2)}</code></pre>
          </section>
        )}
        {output !== undefined && (
          <section>
            <h4 className="mb-1 text-sm text-muted-foreground">Output</h4>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-sm"><code>{JSON.stringify(output, null, 2)}</code></pre>
          </section>
        )}
        {state === "output-error" && errorText && <p className="text-sm text-destructive">{errorText}</p>}
        {state === "input-streaming" && <p className="text-sm text-muted-foreground">Working…</p>}
        {toolCallId && <p className="text-sm text-muted-foreground">Call ID: <code className="font-mono">{toolCallId}</code></p>}
      </CollapsibleContent>
    </Collapsible>
  )
}

export { Tool }
