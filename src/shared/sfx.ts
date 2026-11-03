import type { BuiltinSfx, TransitionId } from './types'

export const BUILTIN_SFX: BuiltinSfx[] = [
  { id: 'whoosh', name: 'Whoosh', fileName: 'whoosh.wav', durationMs: 600, description: 'Transisi cepat / swish sinematik' },
  { id: 'boom', name: 'Deep Boom', fileName: 'boom.wav', durationMs: 1500, description: 'Dentuman sub-bass dramatis' },
  { id: 'riser', name: 'Cinematic Riser', fileName: 'riser.wav', durationMs: 2000, description: 'Ketegangan audio naik' },
  { id: 'knock', name: 'Ketukan Pintu', fileName: 'knock.wav', durationMs: 800, description: 'Ketukan kayu dua kali' },
  { id: 'thunder', name: 'Gemuruh Petir', fileName: 'thunder.wav', durationMs: 2500, description: 'Suara petir & guntur mendalam' },
  { id: 'bell', name: 'Lonceng Misteri', fileName: 'bell.wav', durationMs: 2000, description: 'Denting lonceng kuno' },
  { id: 'glitch', name: 'Digital Glitch', fileName: 'glitch.wav', durationMs: 500, description: 'Distorsi sinyal digital' }
]

/** A scene as the auto-SFX planner sees it: its place on the timeline and the words it speaks there. */
export interface AutoSfxScene {
  startSec: number
  endSec: number
  /** Story, narration and visual prompt; used when the scene has no timed words. */
  text: string
  /** Spoken words, in timeline seconds. */
  words: { text: string; start: number }[]
  /** Transition into the next scene. */
  transition: TransitionId
}

export interface AutoSfxCue {
  sfxId: string
  startMs: number
  volumeDb: number
}

interface KeywordRule {
  sfxId: string
  /** Matched against the start of each lowercased word, or anywhere in it with `inside`. */
  stems: string[]
  inside?: string[]
  volumeDb: number
  /** Seconds before the word, so the hit lands as the word is said. */
  leadSec: number
}

// Ordered by weight: a scene that mentions both thunder and a bell gets the thunder.
// Indonesian prefixes change the first letter (ketuk → mengetuk), so those forms are listed outright.
const KEYWORD_RULES: KeywordRule[] = [
  { sfxId: 'thunder', stems: ['petir', 'guntur', 'geledek', 'halilintar', 'badai', 'thunder', 'lightning', 'storm'], inside: ['gelegar'], volumeDb: -6, leadSec: 0.1 },
  { sfxId: 'boom', stems: ['dentum', 'runtuh', 'ambruk', 'explo', 'boom', 'crash', 'blast'], inside: ['ledak', 'hantam', 'dobrak'], volumeDb: -6, leadSec: 0.05 },
  { sfxId: 'knock', stems: ['ketuk', 'ketok', 'mengetuk', 'mengetok', 'diketuk', 'gedor', 'menggedor', 'digedor', 'knock'], volumeDb: -8, leadSec: 0 },
  { sfxId: 'bell', stems: ['lonceng', 'genta', 'dentang', 'berdentang', 'bell', 'chime'], volumeDb: -8, leadSec: 0 },
  { sfxId: 'glitch', stems: ['glitch', 'statis', 'distorsi', 'korsleting', 'static', 'interferensi'], volumeDb: -10, leadSec: 0 },
  { sfxId: 'whoosh', stems: ['melesat', 'menerjang', 'menyambar', 'berkelebat', 'kelebat', 'whoosh', 'swoosh'], volumeDb: -10, leadSec: 0.2 }
]

/** Transitions with visible movement; a whoosh under a fade or a cut sounds wrong. */
const WHOOSH_TRANSITIONS: TransitionId[] = ['wipeleft', 'wiperight', 'slideleft', 'zoomin']

/** Keeps effects from piling up: any two effects, the same effect twice, and risers. */
const MIN_GAP_SEC = 3
const SAME_SFX_GAP_SEC = 8
const RISER_GAP_SEC = 20
const RISER_SEC = 2

function matchRule(word: string): KeywordRule | null {
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  if (w.length < 3) return null
  return (
    KEYWORD_RULES.find((r) => r.stems.some((s) => w.startsWith(s)) || r.inside?.some((s) => w.includes(s))) ?? null
  )
}

function bestRule(words: string[]): KeywordRule | null {
  let best: KeywordRule | null = null
  for (const w of words) {
    const r = matchRule(w)
    if (r && (!best || KEYWORD_RULES.indexOf(r) < KEYWORD_RULES.indexOf(best))) best = r
  }
  return best
}

/**
 * Picks built-in effects for a finished timeline: at most one keyword hit per scene, timed to the spoken
 * word when Whisper timings exist, a riser leading into big hits, and a whoosh under moving transitions.
 * Volumes sit below the narration so effects accent the story rather than cover it.
 */
export function planAutoSfx(scenes: AutoSfxScene[], totalSec: number): AutoSfxCue[] {
  const cues: AutoSfxCue[] = []
  const at = (sec: number): number => Math.round(sec * 1000)
  const clear = (sec: number, sfxId: string): boolean =>
    cues.every((c) => {
      const gap = Math.abs(c.startMs / 1000 - sec)
      return gap >= MIN_GAP_SEC && (c.sfxId !== sfxId || gap >= SAME_SFX_GAP_SEC)
    })
  const durationOf = (id: string): number => (BUILTIN_SFX.find((s) => s.id === id)?.durationMs ?? 1000) / 1000

  scenes.forEach((scene) => {
    let rule: KeywordRule | null = null
    let sec = scene.startSec + 0.2
    const spoken = scene.words.find((w) => matchRule(w.text))
    if (spoken) {
      rule = bestRule(scene.words.map((w) => w.text))
      const word = scene.words.find((w) => matchRule(w.text) === rule) ?? spoken
      sec = word.start - (rule?.leadSec ?? 0)
    } else if (!scene.words.length) {
      rule = bestRule(scene.text.split(/\s+/))
    }
    if (!rule) return
    sec = Math.max(0, Math.min(sec, totalSec - durationOf(rule.sfxId)))
    if (!clear(sec, rule.sfxId)) return
    cues.push({ sfxId: rule.sfxId, startMs: at(sec), volumeDb: rule.volumeDb })

    // A riser swelling into the hit makes the moment land; spaced out so it stays special.
    if ((rule.sfxId === 'thunder' || rule.sfxId === 'boom') && sec - RISER_SEC >= 0.5) {
      const riserAt = sec - RISER_SEC
      const recent = cues.some((c) => c.sfxId === 'riser' && Math.abs(c.startMs / 1000 - riserAt) < RISER_GAP_SEC)
      const crowded = cues.some((c) => c.sfxId !== rule!.sfxId && Math.abs(c.startMs / 1000 - riserAt) < RISER_SEC)
      if (!recent && !crowded) cues.push({ sfxId: 'riser', startMs: at(riserAt), volumeDb: -12 })
    }
  })

  // Whooshes go last so keyword hits keep priority; centred on the cut where the movement peaks.
  scenes.slice(0, -1).forEach((scene) => {
    if (!WHOOSH_TRANSITIONS.includes(scene.transition)) return
    const sec = Math.max(0, scene.endSec - 0.3)
    if (clear(sec, 'whoosh')) cues.push({ sfxId: 'whoosh', startMs: at(sec), volumeDb: -12 })
  })

  return cues.sort((a, b) => a.startMs - b.startMs)
}
