import { cn } from "@/lib/utils"
import { LoaderCircle } from "lucide-react"

type LoaderSize = "sm" | "md" | "lg"
type IndicatorProps = { className?: string; size?: LoaderSize }
type TextIndicatorProps = IndicatorProps & { text?: string }

export interface LoaderProps extends TextIndicatorProps {
  variant?: "circular" | "classic" | "pulse" | "pulse-dot" | "dots" | "typing" | "wave" | "bars" | "terminal" | "text-blink" | "text-shimmer" | "loading-dots"
}

export function CircularLoader({ className, size = "md" }: IndicatorProps) {
  return (
    <span role="status" className={cn("inline-flex items-center text-muted-foreground", className)}>
      <LoaderCircle aria-hidden="true" className={cn("animate-spin", { sm: "size-4", md: "size-5", lg: "size-6" }[size])} />
      <span className="sr-only">Working…</span>
    </span>
  )
}

export function TextBlinkLoader({ text = "Working…", className, size = "md" }: TextIndicatorProps) {
  return <span role="status" className={cn("text-muted-foreground", size === "lg" ? "text-base" : "text-sm", className)}>{text}</span>
}

export const ClassicLoader = CircularLoader
export const PulseLoader = CircularLoader
export const PulseDotLoader = CircularLoader
export const DotsLoader = CircularLoader
export const TypingLoader = CircularLoader
export const WaveLoader = CircularLoader
export const BarsLoader = CircularLoader
export const TerminalLoader = CircularLoader
export const TextShimmerLoader = TextBlinkLoader
export const TextDotsLoader = TextBlinkLoader

export function Loader({ variant = "circular", text, ...props }: LoaderProps) {
  if (text || variant === "text-blink" || variant === "text-shimmer" || variant === "loading-dots") {
    return <TextBlinkLoader text={text} {...props} />
  }
  return <CircularLoader {...props} />
}
