import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getImageModel, getVideoModel } from '@shared/higgsfield'
import type { AppSettings } from '@shared/types'
import { getDb } from './db'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultTtsProvider: 'gemini',
  defaultLanguage: 'id',
  exportFolder: null,
  llmProvider: 'gemini',
  llmModels: { gemini: 'gemini-3.8-flash', openrouter: '', groq: '', custom: '' },
  customBaseUrl: '',
  geminiTtsModel: 'gemini-3.8-flash-tts',
  elevenModel: 'eleven_multilingual_v2',
  imageModel: DEFAULT_IMAGE_MODEL,
  videoModel: DEFAULT_VIDEO_MODEL,
  whisperAuto: true,
  defaultVisualProvider: 'flow2api',
  flow2apiBaseUrl: 'http://localhost:8000/v1',
  flow2apiImageModel: 'gemini-3.1-flash-image',
  flow2apiVideoModel: 'veo-3.1-fast-i2v',
  higgsfieldConcurrency: 3,
  flow2apiConcurrency: 2,
  imageGenerationMode: 'final',
  storyStyleProfiles: []
}

const clampConcurrency = (value: unknown, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const out: AppSettings = { ...DEFAULT_SETTINGS, llmModels: { ...DEFAULT_SETTINGS.llmModels } }
  for (const r of rows) {
    if (!(r.key in out)) continue
    const value = JSON.parse(r.value)
    if (r.key === 'llmModels') out.llmModels = { ...out.llmModels, ...value }
    else (out as unknown as Record<string, unknown>)[r.key] = value
  }
  // A provider that no longer exists (e.g. from an older build) falls back to Gemini.
  if (!(out.llmProvider in DEFAULT_SETTINGS.llmModels)) out.llmProvider = 'gemini'
  // Models dropped from the Higgsfield catalog fall back to the defaults.
  out.imageModel = getImageModel(out.imageModel).id
  out.videoModel = getVideoModel(out.videoModel).id
  out.higgsfieldConcurrency = clampConcurrency(out.higgsfieldConcurrency, 4, DEFAULT_SETTINGS.higgsfieldConcurrency)
  out.flow2apiConcurrency = clampConcurrency(out.flow2apiConcurrency, 3, DEFAULT_SETTINGS.flow2apiConcurrency)
  if (out.imageGenerationMode !== 'draft' && out.imageGenerationMode !== 'final') out.imageGenerationMode = 'final'
  if (out.defaultVisualProvider !== 'higgsfield' && out.defaultVisualProvider !== 'flow2api') {
    out.defaultVisualProvider = 'flow2api'
  }
  if (out.theme !== 'light' && out.theme !== 'dark' && out.theme !== 'system') {
    out.theme = 'system'
  }
  // Profiles are written from the renderer too; a malformed entry must not break the Idea step or script writing.
  out.storyStyleProfiles = Array.isArray(out.storyStyleProfiles)
    ? out.storyStyleProfiles.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.guidance === 'string')
    : []
  return out
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  getDb().transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue
      let value: unknown = k === 'llmModels' ? { ...current.llmModels, ...(v as object) } : v
      if (k === 'higgsfieldConcurrency') value = clampConcurrency(v, 4, current.higgsfieldConcurrency)
      if (k === 'flow2apiConcurrency') value = clampConcurrency(v, 3, current.flow2apiConcurrency)
      if (k === 'imageGenerationMode' && v !== 'draft' && v !== 'final') value = current.imageGenerationMode
      stmt.run(k, JSON.stringify(value))
    }
  })()
  return getSettings()
}

// ---------- small key/value cache (model lists) ----------

export function readCache<T>(key: string): { value: T; updatedAt: number } | null {
  const row = getDb().prepare('SELECT value, updated_at FROM cache WHERE key = ?').get(key) as
    | { value: string; updated_at: number }
    | undefined
  return row ? { value: JSON.parse(row.value) as T, updatedAt: row.updated_at } : null
}

export function writeCache(key: string, value: unknown): number {
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), now)
  return now
}

export function dropCache(prefix: string): void {
  getDb().prepare('DELETE FROM cache WHERE key LIKE ?').run(`${prefix}%`)
}
