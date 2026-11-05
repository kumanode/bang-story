import { wordCount } from '@shared/script'

/** Sentences with their trailing punctuation and closing quotes; vocal tags stay inside the sentence they sit in. */
function sentencesOf(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  return (clean.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) ?? [clean]).map((s) => s.trim()).filter(Boolean)
}

/**
 * Groups complete sentences into scenes without changing their words. A long sentence stays intact; the
 * scene count follows natural sentence boundaries when the requested count cannot be met cleanly.
 */
export function splitNarration(text: string, parts: number): string[] {
  if (parts <= 0) return []
  const pieces = sentencesOf(text)
  if (!pieces.length) return []
  const sceneCount = Math.min(parts, pieces.length)
  if (pieces.length <= sceneCount) return pieces

  // Linear partition: minimise the squared distance of each scene's word count from the even share.
  const words = pieces.map((p) => Math.max(1, wordCount(p)))
  const prefix = [0]
  for (const w of words) prefix.push(prefix[prefix.length - 1] + w)
  const n = pieces.length
  const target = prefix[n] / sceneCount
  const cost = (from: number, to: number): number => (prefix[to] - prefix[from] - target) ** 2
  const best: number[][] = Array.from({ length: sceneCount + 1 }, () => Array<number>(n + 1).fill(Infinity))
  const cut: number[][] = Array.from({ length: sceneCount + 1 }, () => Array<number>(n + 1).fill(0))
  best[0][0] = 0
  for (let k = 1; k <= sceneCount; k++) {
    for (let end = k; end <= n - (sceneCount - k); end++) {
      for (let start = k - 1; start < end; start++) {
        const value = best[k - 1][start] + cost(start, end)
        if (value < best[k][end]) {
          best[k][end] = value
          cut[k][end] = start
        }
      }
    }
  }
  const scenes: string[] = []
  let end = n
  for (let k = sceneCount; k > 0; k--) {
    const start = cut[k][end]
    scenes.unshift(pieces.slice(start, end).join(' '))
    end = start
  }
  return scenes
}
