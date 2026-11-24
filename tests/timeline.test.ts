import { describe, expect, it } from 'vitest'
import { clipCaptionWords, musicSpan, splitNarration, voiceSpan, wordGapNear } from '@shared/timeline'

describe('timeline', () => {
  it('computes trimmed voice span capped at clip duration', () => {
    const span = voiceSpan({ durationMs: 4000, voiceInMs: 500, voiceOutMs: 6000, voiceStartMs: 1000 }, 8000)
    expect(span).toEqual({ startMs: 1000, inMs: 500, lengthMs: 5500, playMs: 3000 })
  })

  it('shifts and clips caption words to clip-local time', () => {
    const words = [
      { text: 'awal', start: 0.0, end: 0.4 },
      { text: 'tengah', start: 0.6, end: 1.2 },
      { text: 'akhir', start: 2.5, end: 3.0 }
    ]
    const { words: visible, offset } = clipCaptionWords(
      { durationMs: 2000, voiceInMs: 500, voiceOutMs: null, voiceStartMs: 200 },
      words,
      3000
    )
    expect(offset).toBe(1)
    expect(visible).toHaveLength(1)
    expect(visible[0].text).toBe('tengah')
    expect(visible[0].start).toBeCloseTo(0.3, 5)
    expect(visible[0].end).toBeCloseTo(0.9, 5)
  })

  it('clamps music span to timeline bounds', () => {
    expect(musicSpan({ musicStartMs: 2000, musicEndMs: 15000, musicInMs: 500 }, 10)).toEqual({
      startSec: 2,
      endSec: 10,
      inSec: 0.5
    })
  })

  it('splits narration after k-th spoken word while preserving voice tags', () => {
    const [a, b] = splitNarration('<short pause> Halo dunia baru ini', 2)
    expect(a).toBe('<short pause> Halo dunia')
    expect(b).toBe('baru ini')
  })

  it('finds the nearest word gap within reach', () => {
    const words = [
      { text: 'a', start: 0, end: 0.8 },
      { text: 'b', start: 1.2, end: 2.0 },
      { text: 'c', start: 2.4, end: 3.0 }
    ]
    expect(wordGapNear(words, 1.05, 0.4)).toBeCloseTo(1.0, 5)
    expect(wordGapNear(words, 5.0, 0.4)).toBeNull()
  })
})
