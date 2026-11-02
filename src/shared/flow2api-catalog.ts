import type { AspectRatio, ModelOption } from './types'

export interface Flow2ApiModel {
  id: string
  name: string
  family: string
  kind: 'image' | 'video'
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
 * Resolves a base model ID into the exact model name expected by Flow2API,
 * incorporating orientation (landscape/portrait) and clip duration.
 */
export function resolveFlow2ApiModelId(
  baseId: string,
  aspectRatio: AspectRatio,
  durationSec = 6
): string {
  const orient = aspectRatio === '9:16' ? 'portrait' : 'landscape'
  const clean = (baseId || '').trim()

  // If already fully specified with landscape/portrait, preserve or adjust orientation
  if (clean.includes('-landscape') || clean.includes('-portrait')) {
    return clean.replace(/-(landscape|portrait)$/, `-${orient}`)
  }

  // Find model definition
  const videoModel = FLOW2API_VIDEO_MODELS.find((m) => m.id === clean)
  if (videoModel) {
    const allowed = videoModel.durations
    let dur = 6
    if (allowed.length) {
      const closest = allowed.reduce((prev, curr) =>
        Math.abs(curr - durationSec) < Math.abs(prev - durationSec) ? curr : prev
      )
      dur = closest
    }
    return `${clean}-${dur}s-${orient}`
  }

  // For image models
  return `${clean}-${orient}`
}

/**
 * Extracts media URLs (images or mp4 videos) from markdown or text output returned by Flow2API.
 */
export function extractMediaUrls(text: string): string[] {
  const urls: string[] = []
  if (!text) return urls

  // 1. Match Markdown image/link syntax: ![...](url) or [...](url)
  const mdRegex = /!?\[.*?\]\((https?:\/\/[^\s\)\'\"]+|\/[^\s\)\'\"]+)\)/gi
  let match: RegExpExecArray | null
  while ((match = mdRegex.exec(text)) !== null) {
    if (match[1] && !urls.includes(match[1])) {
      urls.push(match[1])
    }
  }

  // 2. Match direct URLs ending in media extensions
  const directRegex = /(https?:\/\/[^\s\)\'\"]+\.(?:png|jpe?g|webp|mp4|mov)(?:\?[^\s\)\'\"]*)?)/gi
  while ((match = directRegex.exec(text)) !== null) {
    if (match[1] && !urls.includes(match[1])) {
      urls.push(match[1])
    }
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
