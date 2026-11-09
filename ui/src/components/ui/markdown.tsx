import { cn } from "@/lib/utils"
import { marked } from "marked"
import { Children, isValidElement, memo, useId, useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { CodeBlock, CodeBlockCode, CodeBlockCopyButton, CodeBlockGroup } from "./code-block"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, node: _node, ...props }) {
    return <code className={cn("rounded-sm bg-muted px-1 font-mono text-sm", className)} {...props}>{children}</code>
  },
  pre: function PreComponent({ children }) {
    const child = Children.toArray(children)[0]
    if (!isValidElement<{ children?: React.ReactNode; className?: string }>(child)) return <pre>{children}</pre>
    const code = String(child.props.children ?? "").replace(/\n$/, "")
    const language = child.props.className?.match(/language-([^\s]+)/)?.[1]
    return (
      <CodeBlock>
        <CodeBlockGroup className="py-1">
          <span className="text-sm text-muted-foreground">{language ?? "Code"}</span>
          <CodeBlockCopyButton code={code} />
        </CodeBlockGroup>
        <CodeBlockCode code={code} language={language} />
      </CodeBlock>
    )
  },
  img: function ImageLink({ src, alt }) {
    return <a href={src} rel="noopener noreferrer">{alt || "View image"}</a>
  },
  a: function SafeLink({ node: _node, target, rel, ...props }) {
    return <a {...props} target={target} rel={target === "_blank" ? "noopener noreferrer" : rel} />
  },
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({ content, components }: { content: string; components: Partial<Components> }) {
    return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>{content}</ReactMarkdown>
  },
  (previous, next) => previous.content === next.content && previous.components === next.components
)

function MarkdownComponent({ children, id, className, components }: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => marked.lexer(children).map((token) => ({ raw: token.raw, unfinished: token.type === 'code' && /^\s*(`{3,}|~{3,})[^\n]*\n/.test(token.raw) && !/\n\s*(`{3,}|~{3,})\s*\n?$/.test(token.raw) })), [children])
  const renderers = useMemo(() => ({ ...INITIAL_COMPONENTS, ...components }), [components])
  return (
    <div className={className}>
      {blocks.map((block, index) => block.unfinished ? <div className="streaming-code" key={`${blockId}-block-${index}`}><p className="helper">Receiving code…</p><pre><code>{block.raw.replace(/^\s*(`{3,}|~{3,})[^\n]*\n/, '')}</code></pre></div> : <MemoizedMarkdownBlock key={`${blockId}-block-${index}`} content={block.raw} components={renderers} />)}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"
export { Markdown }
