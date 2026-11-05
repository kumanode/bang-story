import { wordCount } from '@shared/script'

/** Sentences with their trailing punctuation and closing quotes; vocal tags stay inside the sentence they sit in. */
function sentencesOf(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  return (clean.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) ?? [clean]).map((s) => s.trim()).filter(Boolean)
}

/** Splits one piece in two near its middle, preferring a clause boundary so each half still reads naturally. */
function halve(piece: string): [string, string] | null {
  const words = piece.split(' ')
  if (words.length < 2) return null
  const mid = words.length / 2
  let best = -1
  for (let i = 1; i < words.length; i++) {
    if (!/[,;:—–]$/.test(words[i - 1])) continue
    if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i
  }
  // A clause break far from the middle would leave one scene nearly empty.
  if (best < 0 || Math.abs(best - mid) > words.length * 0.3) best = Math.round(mid)
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

/**
 * Cuts one continuous narration into exactly `parts` consecutive scenes without changing a word, so the
 * voice-over keeps the flow it was written with. Sentences are grouped to keep scene lengths even.
 */
export function splitNarration(text: string, parts: number): string[] {
  if (parts <= 0) return []
  const pieces = sentencesOf(text)
  while (pieces.length < parts) {
    let longest = -1
    for (let i = 0; i < pieces.length; i++) if (longest < 0 || wordCount(pieces[i]) > wordCount(pieces[longest])) longest = i
    const split = longest >= 0 ? halve(pieces[longest]) : null
    if (!split) break
    pieces.splice(longest, 1, ...split)
  }
  if (pieces.length <= parts) return [...pieces, ...Array<string>(parts - pieces.length).fill('')]

  // Linear partition: minimise the squared distance of each scene's word count from the even share.
  const words = pieces.map((p) => Math.max(1, wordCount(p)))
  const prefix = [0]
  for (const w of words) prefix.push(prefix[prefix.length - 1] + w)
  const n = pieces.length
  const target = prefix[n] / parts
  const cost = (from: number, to: number): number => (prefix[to] - prefix[from] - target) ** 2
  const best: number[][] = Array.from({ length: parts + 1 }, () => Array<number>(n + 1).fill(Infinity))
  const cut: number[][] = Array.from({ length: parts + 1 }, () => Array<number>(n + 1).fill(0))
  best[0][0] = 0
  for (let k = 1; k <= parts; k++) {
    for (let end = k; end <= n - (parts - k); end++) {
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
  for (let k = parts; k > 0; k--) {
    const start = cut[k][end]
    scenes.unshift(pieces.slice(start, end).join(' '))
    end = start
  }
  return scenes
}
