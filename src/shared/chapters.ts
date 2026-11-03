export interface ChapterLine {
  startMs: number
  title: string
  durationMs: number
}

/** Groups short scenes so every timestamp begins a chapter of at least ten seconds. */
export function chapterLines(clips: { title: string; durationMs: number }[]): ChapterLine[] {
  const result: ChapterLine[] = []
  let startMs = 0
  let durationMs = 0
  let titles: string[] = []
  clips.forEach((clip, index) => {
    titles.push(clip.title.trim() || `Bagian ${index + 1}`)
    durationMs += Math.max(0, clip.durationMs)
    if (durationMs >= 10_000) {
      result.push({ startMs, durationMs, title: titles.join(' · ') })
      startMs += durationMs
      durationMs = 0
      titles = []
    }
  })
  if (durationMs > 0 && result.length) {
    const last = result[result.length - 1]
    last.title = `${last.title} · ${titles.join(' · ')}`
    last.durationMs += durationMs
  } else if (durationMs > 0) {
    result.push({ startMs: 0, durationMs, title: titles.join(' · ') })
  }
  return result
}

export function formatChapters(clips: { title: string; durationMs: number }[]): string {
  return chapterLines(clips).map(({ startMs, title }) => {
    const seconds = Math.floor(startMs / 1000)
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    const time = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${time} - ${title}`
  }).join('\n')
}
