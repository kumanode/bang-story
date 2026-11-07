import type { StoryStyleId } from './types'

/** Narration styles offered on the Idea step; the main process holds the matching prompt recipes. */
export const STORY_STYLE_OPTIONS: { value: StoryStyleId; label: string }[] = [
  { value: 'casual-education', label: 'Edukasi santai' },
  { value: 'horror-folklore', label: 'Horor / cerita rakyat' },
  { value: 'documentary', label: 'Dokumenter' },
  { value: 'fiction', label: 'Cerita fiksi' },
  { value: 'custom-example', label: 'Ikuti contoh saya' }
]

export const STORY_STYLE_IDS: StoryStyleId[] = STORY_STYLE_OPTIONS.map((o) => o.value)
