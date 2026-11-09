import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CodeBlockCode } from "./code-block"
import { Markdown } from "./markdown"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning"
import { Tool } from "./tool"

test("code is escaped React text with optional language", () => {
  const html = renderToStaticMarkup(<CodeBlockCode code={'<img src="https://example.com/x" onerror="bad()">'} />)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<img|data-language=/)
  assert.match(html, /<pre[^>]*><code>/)
})

test("Markdown skips HTML and turns image markup into links", () => {
  const html = renderToStaticMarkup(<Markdown>{'<script>bad()</script>\n\n![Example](https://example.com/image.png)'}</Markdown>)
  assert.doesNotMatch(html, /<script|<img|bad\(\)/)
  assert.match(html, /<a href="https:\/\/example.com\/image.png"/)
})

test("fenced code has a copy control and unsafe links keep default filtering", () => {
  const html = renderToStaticMarkup(<Markdown>{'```html\n<img src="x">\n```\n\n[Unsafe](javascript:alert%281%29)'}</Markdown>)
  assert.match(html, /aria-label="Copy code"/)
  assert.match(html, /type="button"/)
  assert.match(html, /data-language="html"/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /href="javascript:|<img/)
})

test("custom component overrides remain supported", () => {
  const html = renderToStaticMarkup(<Markdown components={{ strong: ({ children }) => <b data-custom="true">{children}</b> }}>{'**Example**'}</Markdown>)
  assert.match(html, /<b data-custom="true">Example<\/b>/)
})

test("unfinished code streams inside a stable escaped shell", () => {
  const html = renderToStaticMarkup(<Markdown>{'```html\n<img src=x onerror=bad()>'}</Markdown>)
  assert.match(html, /streaming-code/)
  assert.match(html, /Receiving code/)
  assert.doesNotMatch(html, /<img/)
})

test("reasoning trigger controls the same hidden content ID", () => {
  const html = renderToStaticMarkup(<Reasoning><ReasoningTrigger>Reasoning</ReasoningTrigger><ReasoningContent>Details</ReasoningContent></Reasoning>)
  const id = html.match(/aria-controls="([^"]+)"/)?.[1]
  assert.ok(id)
  assert.match(html, /aria-expanded="false"/)
  assert.ok(html.includes(`id="${id}" hidden=""`))
  assert.doesNotMatch(html, /max-height|maxHeight|opacity-0/)
})

test("Tool supports Relay labels and flat status details", () => {
  const html = renderToStaticMarkup(<Tool defaultOpen label="Inspect step" meta="Local" toolPart={{ type: "tool-run", state: "output-error", input: { prompt: "Example" }, errorText: "Stopped" }} />)
  assert.match(html, /Inspect step/)
  assert.match(html, /Local/)
  assert.match(html, /didn&#x27;t finish/)
  assert.match(html, />Input<\/h4>/)
  assert.doesNotMatch(html, /animate-collapsible|bg-red|font-mono[^>]*>Inspect step/)
})
