import { describe, expect, it } from 'vitest'
import { TRANSITION_MAX_SEC, TRANSITION_MIN_SEC, TRANSITION_SEC, cameraAt, cameraCss, transitionSecOf } from '@shared/motion'

describe('motion', () => {
  it('resolves transition duration with cut=0 and clamped custom ms', () => {
    expect(transitionSecOf({ transition: 'cut', transitionMs: 500 })).toBe(0)
    expect(transitionSecOf({ transition: 'fade', transitionMs: null })).toBe(TRANSITION_SEC)
    expect(transitionSecOf({ transition: 'fade', transitionMs: 50 })).toBe(TRANSITION_MIN_SEC)
    expect(transitionSecOf({ transition: 'fade', transitionMs: 9000 })).toBe(TRANSITION_MAX_SEC)
  })

  it('computes static camera as identity and zoomin zoom growing over time', () => {
    const staticFrame = cameraAt('static', 'sedang', 0.5)
    expect(staticFrame).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(cameraCss(staticFrame)).toContain('scale(1')

    const start = cameraAt('zoomin', 'sedang', 0)
    const end = cameraAt('zoomin', 'sedang', 1)
    expect(end.zoom).toBeGreaterThan(start.zoom)
  })
})
