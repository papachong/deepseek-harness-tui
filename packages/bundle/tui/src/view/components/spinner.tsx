/**
 * The `<Spinner>` component: an animated braille-frame indicator for pending
 * tool calls and streaming activity. OpenTUI ships no `<spinner>` primitive,
 * so this drives a `setInterval` tick that cycles a Solid signal through the
 * braille frame set; `onCleanup` clears the timer when the spinner leaves the
 * tree (preventing leaks across re-renders).
 *
 * @module @deepseek-ai/dsh-tui/view/components/spinner
 */

import { type JSX } from '@opentui/solid'
import { createSignal, onCleanup } from 'solid-js'
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from '../theme.js'

/** Props for {@link Spinner}. */
export interface SpinnerProps {
  /** Foreground color (hex or named); when omitted, the text renders in default color. */
  readonly fg?: string
}

/**
 * Render one animated spinner frame. The signal advances every
 * {@link SPINNER_INTERVAL_MS} ms through {@link SPINNER_FRAMES}; the interval
 * is cleared on disposal. Use for pending tool cards and empty streaming
 * messages so the user sees activity before the first delta lands.
 * @param props - the spinner props.
 * @returns a `<text>` rendering the current frame.
 */
export function Spinner(props: SpinnerProps): JSX.Element {
  const [frame, setFrame] = createSignal<number>(0)
  const timer = setInterval(() => {
    setFrame(prev => (prev + 1) % SPINNER_FRAMES.length)
  }, SPINNER_INTERVAL_MS)
  onCleanup(() => clearInterval(timer))
  const fg = props.fg
  return fg === undefined ? <text>{SPINNER_FRAMES[frame()]}</text> : <text fg={fg}>{SPINNER_FRAMES[frame()]}</text>
}
