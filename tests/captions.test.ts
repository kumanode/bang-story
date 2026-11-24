import { describe, expect, it } from 'vitest'
import {
  WHISPER_TIMING,
  captionAt,
  captionNeedsSync,
  captionPopScaleAt,
  chunkWords,
  estimateWordTimings,
  replaceCaptionWords
} from '@shared/captions'

describe('captions', () => {
  it('estimates monotonic word timings within duration', () => {
    const words = estimateWordTimings('Halo dunia ini cerita baru', 5)
    expect(words).toHaveLength(5)
    expect(words[0].start).toBeGreaterThanOrEqual(0)
    expect(words[words.length - 1].end).toBeLessThanOrEqual(5.001)
    for (let i = 1; i < words.length; i++) {
      expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end - 1e-6)
    }
  })

  it('keeps active highlight on the last spoken word during inter-word pauses', () => {
    const words = [
      { text: 'Satu', start: 0, end: 0.4 },
      { text: 'Dua', start: 0.65, end: 1.0 }
    ]
    const chunks = chunkWords(words)
    expect(captionAt(chunks, 0.2)?.word).toBe(0)
    // Pause between 0.4 and 0.65 stays on word 0 instead of flickering.
    expect(captionAt(chunks, 0.52)?.word).toBe(0)
    expect(captionAt(chunks, 0.75)?.word).toBe(1)
  })

  it('detects when captions need Whisper sync', () => {
    expect(captionNeedsSync({ provider: 'elevenlabs', meta: { estimatedTimings: false } })).toBe(false)
    expect(captionNeedsSync({ provider: 'gemini', meta: { estimatedTimings: true } })).toBe(true)
    expect(captionNeedsSync({ provider: 'gemini', meta: { estimatedTimings: false, timedBy: WHISPER_TIMING } })).toBe(false)
    expect(captionNeedsSync({ provider: 'local', meta: { estimatedTimings: true } })).toBe(true)
  })

  it('replaces caption words while preserving surrounding timing span', () => {
    const words = [
      { text: 'Gajah', start: 0, end: 0.5 },
      { text: 'Mata', start: 0.5, end: 1.0 },
      { text: 'pergi', start: 1.0, end: 1.5 }
    ]
    const next = replaceCaptionWords(words, 0, 2, 'Gajah Mada')
    expect(next.map((w) => w.text)).toEqual(['Gajah', 'Mada', 'pergi'])
    expect(next[0].start).toBe(0)
    expect(next[1].end).toBeCloseTo(1.0, 5)
    expect(next[2].start).toBe(1.0)
  })

  it('animates caption pop scale from 1.0 to 1.15 over 80ms', () => {
    expect(captionPopScaleAt(0)).toBe(1)
    expect(captionPopScaleAt(0.04)).toBeGreaterThan(1)
    expect(captionPopScaleAt(0.04)).toBeLessThan(1.15)
    expect(captionPopScaleAt(0.1)).toBe(1.15)
  })
})
