/**
 * Incremental block-level markdown parsing for an append-only text stream —
 * a terminal-native port of
 * `packages/client/ui-primitives/src/markdown/incremental.ts`. Re-parsing the
 * whole accumulated document on every streaming chunk is quadratic; this
 * parser freezes all but the trailing blocks and re-parses only the source
 * tail, so each source region is parsed O(1) times over the stream.
 *
 * @module @deepseek-ai/dsh-tui/render/markdown/incremental
 */

import type { Root, RootContent } from 'mdast'

/** Trailing blocks kept unstable (safety margin for the parse frontier). */
const UNSTABLE_TAIL_BLOCKS = 2

/** A top-level mdast block plus a render key that is stable across chunks. */
export interface PositionedBlock {
  readonly node: RootContent
  readonly key: number
}

/** One {@link IncrementalMarkdownParser.update} result. */
export interface IncrementalBlocks {
  readonly frozen: readonly PositionedBlock[]
  readonly tail: readonly PositionedBlock[]
  readonly generation: number
}

/** A block's render key: its absolute source start offset (or negative fallback). */
function blockKey(node: RootContent, base: number, index: number): number {
  const offset = node.position?.start.offset
  return offset === undefined ? -(index + 1) : base + offset
}

/**
 * Append-only incremental parser over a caller-supplied grammar. One instance
 * accumulates one streaming document; non-append input resets it.
 */
export class IncrementalMarkdownParser {
  private prevText = ''
  private tailStart = 0
  private frozen: PositionedBlock[] = []
  private generation = 0
  private cached: IncrementalBlocks | null = null

  constructor(private readonly parse: (text: string) => Root) {}

  /**
   * Fold the current accumulated text and return the frozen/tail split.
   * Idempotent for identical input.
   */
  update(text: string): IncrementalBlocks {
    if (this.cached !== null && text === this.prevText) return this.cached
    if (!text.startsWith(this.prevText)) {
      this.prevText = ''
      this.tailStart = 0
      this.frozen = []
      this.generation += 1
    }
    this.prevText = text
    const base = this.tailStart
    const blocks = this.parse(text.slice(base)).children
    let firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS)
    if (firstUnstable > 0) {
      const cutEnd = blocks[firstUnstable - 1]?.position?.end.offset
      if (cutEnd === undefined) {
        firstUnstable = 0
      } else {
        for (const node of blocks.slice(0, firstUnstable)) {
          this.frozen.push({ node, key: blockKey(node, base, this.frozen.length) })
        }
        this.tailStart = base + cutEnd
      }
    }
    const tail = blocks.slice(firstUnstable).map((node, index) => ({
      node,
      key: blockKey(node, base, index),
    }))
    this.cached = { frozen: [...this.frozen], tail, generation: this.generation }
    return this.cached
  }
}
