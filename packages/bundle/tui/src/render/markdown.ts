/**
 * Terminal markdown renderer: renders a subset of GFM block/inline markdown to
 * plain stdout text with ANSI SGR decorations (bold/italic/underline/code).
 * No syntax highlighting, no KaTeX (Phase 2 ships readable inline+block
 * structure; math/code-coloring is deferred). Consumes the
 * {@link IncrementalMarkdownParser} over the GFM grammar for O(1)/chunk
 * streaming folding.
 *
 * @module @deepseek-ai/dsh-tui/render/markdown
 */

import type { Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { IncrementalMarkdownParser, type IncrementalBlocks } from './markdown/incremental.js'

/** ANSI SGR escape (CSI). */
const SGR = (code: string): string => `\x1b[${code}m`
const RESET = SGR('0')
const BOLD = SGR('1')
const DIM = SGR('2')
const ITALIC = SGR('3')
const UNDERLINE = SGR('4')
const STRIKETHROUGH = SGR('9')

/** The GFM streaming grammar (no math, so incomplete TeX never flashes errors). */
function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/** One streaming markdown renderer instance. */
export class TerminalMarkdown {
  private readonly parser = new IncrementalMarkdownParser(parseGfm)
  private buffer = ''

  /**
   * Append a text delta and return the full rendered output so far.
   * @param delta - the streamed text chunk.
   * @returns the full accumulated markdown rendered to ANSI-styled text.
   */
  append(delta: string): string {
    this.buffer += delta
    const blocks = this.parser.update(this.buffer)
    return renderBlocks(blocks)
  }

  /** Reset the stream for a new message. */
  reset(): void {
    this.buffer = ''
    this.parser.update('')
  }
}

/** Render the frozen + tail blocks to a single string. */
function renderBlocks(blocks: IncrementalBlocks): string {
  const all = [...blocks.frozen, ...blocks.tail]
  return all.map(b => renderNode(b.node)).join('\n\n')
}

/** Recursively render an mdast node to ANSI-styled text. */
function renderNode(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const n = node as { type: string; children?: unknown[]; value?: string; url?: string; ordered?: boolean; items?: unknown[] }
  switch (n.type) {
    case 'root':
      return (n.children ?? []).map(renderNode).join('\n')
    case 'paragraph':
      return (n.children ?? []).map(renderNodeInline).join('')
    case 'heading': {
      const depth = (node as { depth?: number }).depth ?? 1
      const prefix = '#'.repeat(Math.min(depth, 6))
      return `${BOLD}${prefix} ${(n.children ?? []).map(renderNodeInline).join('')}${RESET}`
    }
    case 'code': {
      const value = n.value ?? ''
      return `${DIM}${value}${RESET}`
    }
    case 'list': {
      const items = n.items ?? []
      return items.map((item, i) => {
        const marker = n.ordered === true ? `${(i + 1)}. ` : '- '
        return `${marker}${renderNode(item)}`
      }).join('\n')
    }
    case 'listItem':
      return (n.children ?? []).map(renderNode).join('\n')
    case 'blockquote': {
      const inner = (n.children ?? []).map(renderNode).join('\n')
      return inner.split('\n').map(l => `> ${l}`).join('\n')
    }
    case 'thematicBreak':
      return '---'
    case 'table': {
      const rows = (node as { children?: unknown[] }).children ?? []
      return rows.map(row => '| ' + ((row as { children?: unknown[] }).children ?? [])
        .map(cell => renderNode(cell)).join(' | ') + ' |').join('\n')
    }
    case 'text':
      return n.value ?? ''
    default:
      return n.value ?? ''
  }
}

/** Render an inline mdast node (inside a paragraph/heading). */
function renderNodeInline(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const n = node as { type: string; children?: unknown[]; value?: string; url?: string }
  switch (n.type) {
    case 'strong':
      return `${BOLD}${(n.children ?? []).map(renderNodeInline).join('')}${RESET}`
    case 'emphasis':
      return `${ITALIC}${(n.children ?? []).map(renderNodeInline).join('')}${RESET}`
    case 'delete':
      return `${STRIKETHROUGH}${(n.children ?? []).map(renderNodeInline).join('')}${RESET}`
    case 'link': {
      const text = (n.children ?? []).map(renderNodeInline).join('')
      return `${UNDERLINE}${text}${RESET}`
    }
    case 'code':
      return `${DIM}${n.value ?? ''}${RESET}`
    case 'text':
      return n.value ?? ''
    default:
      return n.value ?? ''
  }
}
