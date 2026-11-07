import type { StoryStyleId } from '@shared/types'
import { recipeFor } from './storyStyles'

export interface StyleIssue {
  problem: string
  instruction: string
  /** Minor issues are fixed only when a chapter is rewritten for another reason. */
  minor?: boolean
}

const HEDGES = /\b(?:mungkin|barangkali|agaknya|kiranya|sepertinya)\b/giu
const IGNORE_REPEATS = new Set(['adalah', 'akan', 'atau', 'bahwa', 'dalam', 'dengan', 'dari', 'dapat', 'ini', 'itu', 'karena', 'kamu', 'kami', 'kita', 'mereka', 'pada', 'para', 'saat', 'saja', 'sebagai', 'setelah', 'sudah', 'tidak', 'untuk', 'yang'])

export interface StyleContext {
  /** Topic words (title, question, chapter title, key detail) that a chapter is expected to repeat. */
  topicWords?: string[]
  /** Viewer address is a property of the opening; later chapters may stay in the scene without "kamu". */
  isOpening?: boolean
}

export function checkChapterStyle(text: string, style: StoryStyleId | undefined, context: StyleContext = {}): StyleIssue[] {
  const recipe = recipeFor(style) ?? recipeFor('casual-education')!
  // A creator profile may intentionally avoid direct viewer address, so only flag it when a built-in recipe asks for it.
  const limits = style === 'custom-example' ? { ...recipe.limits, addressViewer: false } : recipe.limits
  const issues: StyleIssue[] = []
  const clean = text.trim()
  if (!clean) return issues
  const hedges = clean.match(HEDGES)?.length ?? 0
  if (hedges > limits.maxHedges) {
    issues.push({ problem: `Ada ${hedges} kata ragu; batas gaya ini ${limits.maxHedges}.`, instruction: `Kurangi kata ragu seperti “mungkin” menjadi paling banyak ${limits.maxHedges} untuk bab ini.` })
  }

  const longSentences = clean.split(/(?<=[.!?…])\s+/u).filter((sentence) => sentence.split(/\s+/u).length > limits.maxSentenceWords)
  if (longSentences.length) {
    issues.push({ problem: `${longSentences.length} kalimat melewati ${limits.maxSentenceWords} kata.`, instruction: `Pecah atau tulis ulang kalimat yang terlalu panjang. Jaga setiap kalimat sekitar ${limits.maxSentenceWords} kata atau kurang dan tetap satu kalimat per baris.` })
  }

  const topic = new Set(context.topicWords ?? [])
  const words = clean.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  // The limit is per ~150 spoken words, so long chapters are not punished for their length.
  const repeatLimit = limits.maxRepeatedWord * Math.max(1, Math.round(words.length / 150))
  const overused = new Map<string, number>()
  for (const word of words) {
    if (word.length < 5 || IGNORE_REPEATS.has(word) || topic.has(word)) continue
    overused.set(word, (overused.get(word) ?? 0) + 1)
  }
  const repeated = [...overused.entries()].filter(([, count]) => count > repeatLimit).sort((a, b) => b[1] - a[1])[0]
  if (repeated) issues.push({ problem: `Kata “${repeated[0]}” muncul ${repeated[1]} kali dalam bab ini.`, instruction: `Kurangi pengulangan kata “${repeated[0]}” dan variasikan cara menyampaikan gagasan.` })

  if (limits.addressViewer && context.isOpening && !/\bkamu\b/iu.test(clean)) {
    issues.push({ problem: 'Sapaan langsung kepada penonton tidak muncul.', instruction: 'Tambahkan satu sapaan “kamu” yang terasa wajar di bagian yang paling cocok; jangan menyisipkannya di setiap kalimat.' })
  }

  const crowdedLines = clean.split(/\r?\n/u).filter((line) => (line.match(/[.!?…](?:[”’"')\]]*)?(?:\s|$)/gu)?.length ?? 0) > 1)
  if (crowdedLines.length) {
    issues.push({ problem: `${crowdedLines.length} baris memuat lebih dari satu kalimat.`, instruction: 'Letakkan satu kalimat lengkap pada setiap baris.', minor: true })
  }
  return issues
}
