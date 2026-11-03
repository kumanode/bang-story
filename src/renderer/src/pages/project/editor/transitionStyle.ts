import type { CSSProperties } from 'react'
import type { TransitionId } from '@shared/types'

/**
 * How the outgoing clip (prev, drawn on top) and the incoming clip (cur) look at transition progress k
 * (0 to 1). Matches the FFmpeg xfade transitions of the export closely enough to judge them in the preview.
 */
export function transitionStyles(transition: TransitionId, k: number): { prev: CSSProperties; cur: CSSProperties } {
  if (transition === 'slideleft') return { prev: { transform: `translateX(${-k * 100}%)` }, cur: { transform: `translateX(${(1 - k) * 100}%)` } }
  if (transition === 'zoomin') return { prev: { transform: `scale(${1 + k * 0.6})`, opacity: 1 - k }, cur: {} }
  if (transition === 'wipeleft') return { prev: { clipPath: `inset(0 ${k * 100}% 0 0)` }, cur: {} }
  if (transition === 'wiperight') return { prev: { clipPath: `inset(0 0 0 ${k * 100}%)` }, cur: {} }
  if (transition === 'dissolve') {
    const flash = k < 0.5 ? k * 2 : (1 - k) * 2
    return { prev: { opacity: 1 - k, filter: `brightness(${1 + flash * 3})` }, cur: { opacity: k, filter: `brightness(${1 + flash * 3})` } }
  }
  if (transition === 'dipblack') {
    if (k < 0.5) return { prev: { opacity: 1 - k * 2 }, cur: { opacity: 0 } }
    return { prev: { opacity: 0 }, cur: { opacity: (k - 0.5) * 2 } }
  }
  return { prev: { opacity: 1 - k }, cur: {} }
}
