import type { FilterId } from './types'

export interface FilterPreset {
  id: FilterId
  name: string
  contrast: number
  brightness: number
  saturation: number
  sepia: number
  hueRotate: number
  swatch: string
  ink: string
  description: string
}

export const FILTERS: FilterPreset[] = [
  {
    id: 'normal',
    name: 'Normal',
    contrast: 1.0,
    brightness: 0.0,
    saturation: 1.0,
    sepia: 0,
    hueRotate: 0,
    swatch: '#EAE5D9',
    ink: '#1F1D1A',
    description: 'Warna asli alami tanpa gradasi khusus'
  },
  {
    id: 'warm',
    name: 'Warm Tale',
    contrast: 1.08,
    brightness: 0.04,
    saturation: 1.18,
    sepia: 0.18,
    hueRotate: -5,
    swatch: '#FDE047',
    ink: '#713F12',
    description: 'Hangat keemasan, ramah, cocok untuk dongeng & nostalgia'
  },
  {
    id: 'cold',
    name: 'Cold Mystery',
    contrast: 1.15,
    brightness: -0.02,
    saturation: 0.85,
    sepia: 0,
    hueRotate: 18,
    swatch: '#67E8F9',
    ink: '#164E63',
    description: 'Dingin mencekam, tegang, pas untuk misteri & horor'
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    contrast: 1.25,
    brightness: 0.03,
    saturation: 1.5,
    sepia: 0,
    hueRotate: -15,
    swatch: '#F43F5E',
    ink: '#881337',
    description: 'Kontras tajam, warna neon menyala, dinamis & modern'
  },
  {
    id: 'noir',
    name: 'Film Noir',
    contrast: 1.35,
    brightness: 0.0,
    saturation: 0.0,
    sepia: 0,
    hueRotate: 0,
    swatch: '#18181B',
    ink: '#FAFAFA',
    description: 'Hitam putih dramatis dengan bayangan pekat sinematik'
  },
  {
    id: 'vintage',
    name: 'Vintage Sepia',
    contrast: 1.05,
    brightness: 0.02,
    saturation: 0.65,
    sepia: 0.45,
    hueRotate: -8,
    swatch: '#D97706',
    ink: '#451A03',
    description: 'Koleksi arsip klasik, kuno, bertekstur kertas tua'
  }
]

/** CSS filter string for preview player. */
export function filterCss(id: FilterId | null | undefined): string {
  if (!id || id === 'normal') return 'none'
  const f = FILTERS.find((x) => x.id === id)
  if (!f) return 'none'
  const parts: string[] = []
  if (f.contrast !== 1.0) parts.push(`contrast(${f.contrast})`)
  if (f.brightness !== 0.0) parts.push(`brightness(${1 + f.brightness})`)
  if (f.saturation !== 1.0) parts.push(`saturate(${f.saturation})`)
  if (f.sepia > 0) parts.push(`sepia(${f.sepia})`)
  if (f.hueRotate !== 0) parts.push(`hue-rotate(${f.hueRotate}deg)`)
  return parts.length ? parts.join(' ') : 'none'
}

/** FFmpeg filter string for exporter. */
export function filterFfmpeg(id: FilterId | null | undefined): string | null {
  if (!id || id === 'normal') return null
  const f = FILTERS.find((x) => x.id === id)
  if (!f) return null
  const filters: string[] = []
  // Multiplicative RGB brightness matches CSS brightness(), unlike eq's additive luma offset.
  filters.push(`eq=contrast=${f.contrast}:brightness=0:saturation=${f.saturation}`)
  if (f.brightness !== 0) {
    const factor = (1 + f.brightness).toFixed(3)
    filters.push(`lutrgb=r='val*${factor}':g='val*${factor}':b='val*${factor}'`)
  }
  if (f.sepia > 0) {
    const s = f.sepia
    const r1 = (1 - s + 0.393 * s).toFixed(3)
    const r2 = (0.769 * s).toFixed(3)
    const r3 = (0.189 * s).toFixed(3)
    const g1 = (0.349 * s).toFixed(3)
    const g2 = (1 - s + 0.686 * s).toFixed(3)
    const g3 = (0.168 * s).toFixed(3)
    const b1 = (0.272 * s).toFixed(3)
    const b2 = (0.534 * s).toFixed(3)
    const b3 = (1 - s + 0.131 * s).toFixed(3)
    filters.push(`colorchannelmixer=${r1}:${r2}:${r3}:0:${g1}:${g2}:${g3}:0:${b1}:${b2}:${b3}:0`)
  }
  if (f.hueRotate !== 0) filters.push(`hue=h=${f.hueRotate}`)
  return filters.join(',')
}
