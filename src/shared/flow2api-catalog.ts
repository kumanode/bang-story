import type { AspectRatio, ModelOption } from './types'

export interface Flow2ApiModel {
  id: string
  name: string
  family: string
  kind: 'image' | 'video'
  /** Model name sent to Flow2API; its resolver picks the internal Veo key from image count, aspect and duration. */
  apiModel?: string
  durations: number[]
  supportsRef: boolean
  maxRefs: number
  tags: string[]
  description: string
}

export const FLOW2API_IMAGE_MODELS: Flow2ApiModel[] = [
  {
    id: 'gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash Image',
    family: 'Google Imagen',
    kind: 'image',
    durations: [],
    supportsRef: true,
    maxRefs: 3,
    tags: ['Rekomendasi', 'Cepat', 'Nano Banana'],
    description: 'Generasi gambar cepat dan konsisten dengan dukungan referensi karakter'
  },
  {
    id: 'imagen-3.0',
    name: 'Imagen 3.0',
    family: 'Google Imagen',
    kind: 'image',
    durations: [],
    supportsRef: false,
    maxRefs: 0,
    tags: ['Fotorealistik', 'Google DeepMind'],
    description: 'Kualitas fotorealistik tinggi untuk latar dan komposisi sinematik'
  }
]

export const FLOW2API_VIDEO_MODELS: Flow2ApiModel[] = [
  {
    id: 'veo-3.1-fast-i2v',
    apiModel: 'veo-i2v-fast',
    name: 'Veo 3.1 Fast (I2V)',
    family: 'Google Veo',
    kind: 'video',
    durations: [4, 6, 8],
    supportsRef: true,
    maxRefs: 1,
    tags: ['Rekomendasi', 'Cepat', 'Gambar ke Video'],
    description: 'Animasi adegan halus dari frame awal gambar klip'
  },
  {
    id: 'veo-3.1-lite-i2v',
    apiModel: 'veo-i2v-lite',
    name: 'Veo 3.1 Lite (I2V)',
    family: 'Google Veo',
    kind: 'video',
    durations: [4, 6, 8],
    supportsRef: true,
    maxRefs: 1,
    tags: ['Hemat Kuota', 'Gambar ke Video'],
    description: 'Varian ringan Veo 3.1 untuk rendering lebih cepat'
  },
  {
    id: 'omni-1.1-flash',
    apiModel: 'Omni 1.1 Flash',
    name: 'Omni 1.1 Flash',
    family: 'Google Flow',
    kind: 'video',
    durations: [4, 6, 8, 10],
    supportsRef: true,
    maxRefs: 3,
    tags: ['Multi-Ref', 'Google Flow'],
    description: 'Dukungan hingga 3 gambar referensi untuk kontrol gerak lanjutan'
  },
  {
    id: 'veo-3.1-fast',
    apiModel: 'veo-fast',
    name: 'Veo 3.1 Fast (T2V)',
    family: 'Google Veo',
    kind: 'video',
    durations: [4, 6, 8],
    supportsRef: false,
    maxRefs: 0,
    tags: ['Teks ke Video'],
    description: 'Generasi video langsung dari prompt teks'
  }
]

export const DEFAULT_FLOW2API_IMAGE_MODEL = 'gemini-3.1-flash-image'
export const DEFAULT_FLOW2API_VIDEO_MODEL = 'veo-3.1-fast-i2v'

export function getFlow2ApiModel(id: string | null | undefined, kind: 'image' | 'video'): Flow2ApiModel {
  const list = kind === 'image' ? FLOW2API_IMAGE_MODELS : FLOW2API_VIDEO_MODELS
  const def = kind === 'image' ? DEFAULT_FLOW2API_IMAGE_MODEL : DEFAULT_FLOW2API_VIDEO_MODEL
  return list.find((m) => m.id === id) ?? list.find((m) => m.id === def)!
}

/**
 * Resolves an image model ID into the exact model name expected by Flow2API, including orientation.
 */
export function resolveFlow2ApiModelId(baseId: string, aspectRatio: AspectRatio): string {
  const orient = aspectRatio === '9:16' ? 'portrait' : 'landscape'
  const clean = (baseId || '').trim()
  if (clean.includes('-landscape') || clean.includes('-portrait')) {
    return clean.replace(/-(landscape|portrait)$/, `-${orient}`)
  }
  return `${clean}-${orient}`
}

export interface Flow2ApiVideoRequest {
  model: string
  aspectRatio: '16:9' | '9:16'
  durationSec: number
  /** False for text-to-video models: sending the clip image would switch Flow2API to image-to-video. */
  withImage: boolean
}

/**
 * Maps a catalog video model to Flow2API's public alias plus generationConfig values. Flow2API rejects
 * unknown names like `veo-3.1-fast-i2v-6s-landscape` with an in-stream error, so the internal
 * Veo key (orientation, duration, i2v vs t2v) must be left to its own resolver.
 */
export function resolveFlow2ApiVideo(baseId: string, aspectRatio: AspectRatio, durationSec = 6): Flow2ApiVideoRequest {
  // Older builds stored fully suffixed IDs such as `veo-3.1-fast-i2v-6s-landscape`.
  const clean = (baseId || '').trim().replace(/-\d+s-(landscape|portrait)$/, '').replace(/-(landscape|portrait)$/, '')
  const known = FLOW2API_VIDEO_MODELS.find((m) => m.id === clean)
  const model = known ?? (clean ? null : getFlow2ApiModel(null, 'video'))
  const allowed = model?.durations ?? []
  const dur = allowed.length
    ? allowed.reduce((prev, curr) => (Math.abs(curr - durationSec) < Math.abs(prev - durationSec) ? curr : prev))
    : durationSec
  return {
    // Unknown IDs are passed through so users can type any model Flow2API itself lists.
    model: model?.apiModel ?? clean,
    aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9',
    durationSec: dur,
    withImage: model ? model.supportsRef : true
  }
}

/**
 * Extracts media URLs (images or mp4 videos) from markdown or text output returned by Flow2API.
 */
export function extractMediaUrls(text: string): string[] {
  const urls: string[] = []
  if (!text) return urls

  const add = (u: string | undefined): void => {
    if (!u) return
    const clean = u.trim().replace(/^["']|["']$/g, '')
    if (clean && !urls.includes(clean)) {
      urls.push(clean)
    }
  }

  // 1. Match Markdown image/link syntax: ![...](url) or [...](url)
  const mdRegex = /!?\[.*?\]\((https?:\/\/[^\s\)\'\"]+|\/[^\s\)\'\"]+)\)/gi
  let match: RegExpExecArray | null
  while ((match = mdRegex.exec(text)) !== null) {
    add(match[1])
  }

  // 2. Match HTML image/video/source tags: <img src="..."> or <video src="...">
  const htmlRegex = /<(?:img|video|source)[^>]+src=["']([^"']+)["']/gi
  while ((match = htmlRegex.exec(text)) !== null) {
    add(match[1])
  }

  // 3. Match JSON url fields: "url": "..." or "video_url": "..."
  const jsonRegex = /"(?:url|media_url|image_url|video_url|src)":\s*"([^"]+)"/gi
  while ((match = jsonRegex.exec(text)) !== null) {
    add(match[1])
  }

  // 4. Match direct URLs ending in media extensions
  const directRegex = /(https?:\/\/[^\s\)\'\"<>]+(?:\.png|\.jpe?g|\.webp|\.mp4|\.mov)(?:\?[^\s\)\'\"<>]*)?)/gi
  while ((match = directRegex.exec(text)) !== null) {
    add(match[1])
  }

  // 5. Match direct Google Cloud Storage or Flow2API media paths
  const cloudRegex = /(https?:\/\/[^\s\)\'\"<>]+(?:storage\.googleapis\.com|\/media\/|\/outputs?\/)[^\s\)\'\"<>]+)/gi
  while ((match = cloudRegex.exec(text)) !== null) {
    add(match[1])
  }

  return urls
}

/**
 * Normalizes relative URLs (e.g. /media/xxx.mp4) or local container URLs to the configured Flow2API Base URL.
 */
export function normalizeMediaUrl(rawUrl: string, baseUrl: string): string {
  const trimmedUrl = rawUrl.trim()
  const trimmedBase = baseUrl.trim().replace(/\/+$/, '')

  try {
    const baseObj = new URL(trimmedBase)
    if (trimmedUrl.startsWith('/')) {
      return `${baseObj.origin}${trimmedUrl}`
    }

    const targetObj = new URL(trimmedUrl)
    // If target URL points to localhost or 127.0.0.1 while baseUrl is on a different host,
    // rewrite host/port to point to the user's configured base host.
    if ((targetObj.hostname === 'localhost' || targetObj.hostname === '127.0.0.1') &&
        baseObj.hostname !== 'localhost' && baseObj.hostname !== '127.0.0.1') {
      targetObj.protocol = baseObj.protocol
      targetObj.hostname = baseObj.hostname
      targetObj.port = baseObj.port
      return targetObj.href
    }
    return targetObj.href
  } catch {
    return trimmedUrl
  }
}

/**
 * Returns ModelOption array formatted for UI pickers in Settings and ModelSection.
 */
export function flow2apiModelOptions(kind: 'image' | 'video'): ModelOption[] {
  const list = kind === 'image' ? FLOW2API_IMAGE_MODELS : FLOW2API_VIDEO_MODELS
  const def = kind === 'image' ? DEFAULT_FLOW2API_IMAGE_MODEL : DEFAULT_FLOW2API_VIDEO_MODEL
  return [...list.filter((m) => m.id === def), ...list.filter((m) => m.id !== def)].map((m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    description: m.description,
    tags: m.id === def ? ['Rekomendasi', ...m.tags] : m.tags
  }))
}
