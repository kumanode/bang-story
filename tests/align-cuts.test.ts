import { describe, expect, it } from 'vitest'
import { alignWords, splitHeard } from '../src/main/align'
import { chooseCuts, cutsFromWords } from '../src/main/cuts'

describe('align & cuts', () => {
  it('splits multi-word Whisper segments proportionally by character length', () => {
    const heard = splitHeard([{ text: 'Halo dunia', start: 1.0, end: 2.0 }])
    expect(heard).toHaveLength(2)
    expect(heard[0].start).toBeCloseTo(1.0, 5)
    expect(heard[1].end).toBeCloseTo(2.0, 5)
    expect(heard[0].end).toBeCloseTo(heard[1].start, 5)
  })

  it('aligns script spelling to Whisper word times including mishearings', () => {
    const aligned = alignWords(
      ['Gajah', 'Mada', 'bersumpah'],
      [
        { text: 'Gaja', start: 0.2, end: 0.6 },
        { text: 'Mada', start: 0.65, end: 1.0 },
        { text: 'bersumpah', start: 1.1, end: 1.8 }
      ],
      2.0
    )
    expect(aligned.map((w) => w.text)).toEqual(['Gajah', 'Mada', 'bersumpah'])
    expect(aligned[0].start).toBeCloseTo(0.2, 5)
    expect(aligned[2].end).toBeCloseTo(1.8, 5)
  })

  it('places scene cuts inside silences overlapping inter-scene word gaps', () => {
    const cuts = cutsFromWords(
      [{ end: 3.0, start: 3.8 }],
      [
        { start: 1.0, end: 1.2 },
        { start: 3.1, end: 3.7 }
      ]
    )
    expect(cuts).toHaveLength(1)
    expect(cuts[0]).toBeCloseTo(3.4, 5)
  })

  it('chooses ordered cuts near expected proportions when silences are present', () => {
    const cuts = chooseCuts(
      12,
      [10, 10, 10],
      [
        { start: 3.8, end: 4.4 },
        { start: 7.7, end: 8.3 }
      ]
    )
    expect(cuts).toHaveLength(2)
    expect(cuts[0]).toBeCloseTo(4.1, 1)
    expect(cuts[1]).toBeCloseTo(8.0, 1)
  })
})
