"use client"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { type VariantProps } from "class-variance-authority"
import { ChevronDown } from "lucide-react"
import { useStickToBottomContext } from "use-stick-to-bottom"

export type ScrollButtonProps = {
  className?: string
  variant?: VariantProps<typeof buttonVariants>["variant"]
  size?: VariantProps<typeof buttonVariants>["size"]
} & React.ButtonHTMLAttributes<HTMLButtonElement>

function ScrollButton({
  className,
  variant = "outline",
  size = "sm",
  ...props
}: ScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  if (isAtBottom) return null

  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "size-11 min-h-11 min-w-11 rounded-full transition-transform duration-150 ease-out",
        className
      )}
      onClick={() => scrollToBottom("instant")}
      {...props}
      type="button"
      aria-label={props["aria-label"] ?? "Scroll to latest message"}
    >
      <ChevronDown aria-hidden="true" className="h-5 w-5" />
    </Button>
  )
}

export { ScrollButton }
