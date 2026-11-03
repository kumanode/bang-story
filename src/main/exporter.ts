import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  CAPTION_BOX_PAD,
  CAPTION_BOX_RADIUS,
  CAPTION_ACTIVE_SCALE,
  CAPTION_PILL_PAD_EM,
  CAPTION_POP_DURATION_MS,
  CAPTION_GLOW_BLUR_RATIO,
  CAPTION_GLOW_OUTLINE_RATIO,
  CAPTION_MAX_WIDTH,
  captionFontFile,
  captionWordGap,
  captionScaleOf,
  layoutCaptionLines,
  roundedRectPath,
  POPPINS_CELL,
  displayWord,
  resolveCaption,
  timelineChunks,
  type CaptionChunk,
  type ResolvedCaption
} from '@shared/captions'
import { cameraPerspective, TRANSITIONS, transitionSecOf } from '@shared/motion'
import { clipCaptionWords, musicSpan, voiceSpan } from '@shared/timeline'
import { anchorOffset, contrastColor, overlayEnd, textEffects } from '@shared/overlays'
import { filterFfmpeg } from '@shared/filters'
import type { Asset, Clip, ExportOptions, ImageOverlay, Job, ProjectBundle, TextOverlay } from '@shared/types'
import { emit } from './events'
import { runJob, type TaskCtx } from './jobs'
import { fontMeasure } from './fontMetrics'
import { assetAbsPath, binPath, dataDir, fontsDir } from './paths'
import { getBundle, insertJob, touchProject } from './repo'

function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('FFmpeg tidak ditemukan di aplikasi')
  return binPath(ffmpegStatic)
}

function outputSize(aspect: '16:9' | '9:16', res: ExportOptions['resolution']): { w: number; h: number } {
  const long = res === 720 ? 1280 : res === 1080 ? 1920 : 3840
  const short = res
  return aspect === '16:9' ? { w: long, h: short } : { w: short, h: long }
}

/** Runs ffmpeg in `cwd`, reporting progress from its `time=` output against `totalSec`. */
function runFfmpeg(args: string[], cwd: string, signal: AbortSignal, totalSec?: number, onProgress?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { cwd, windowsHide: true })
    let tail = ''
    const onAbort = (): void => {
      p.kill('SIGKILL')
    }
    signal.addEventListener('abort', onAbort)
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      tail = (tail + s).slice(-4000)
      if (totalSec && onProgress) {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
        if (m) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / totalSec))
      }
    })
    p.on('error', reject)
    p.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) return reject(new Error('Dibatalkan'))
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg gagal (kode ${code}): ${tail.split('\n').slice(-6).join(' ').trim()}`))
    })
  })
}

// ---------- captions ----------

const FONT_BY_WEIGHT: Record<number, { name: string; bold: number }> = {
  500: { name: 'Poppins Medium', bold: 0 },
  600: { name: 'Poppins SemiBold', bold: 0 },
  700: { name: 'Poppins', bold: -1 },
  800: { name: 'Poppins ExtraBold', bold: 0 }
}

/** #RRGGBB + opacity → ASS &HAABBGGRR */
function assColor(hex: string, opacity = 1): string {
  const h = hex.replace('#', '')
  const a = Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(2, '0')
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}

function assInlineColor(hex: string): string {
  const h = hex.replace('#', '')
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase()
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

const escapeAss = (t: string): string => t.replace(/\\/g, '\\\\').replace(/[{}]/g, '')

interface CaptionTrack {
  chunks: CaptionChunk[]
  style: ResolvedCaption
  pos: string
  sizeScale: number
}

/** Overlay text styles; each line then sets its own size, colors and position with override tags. */
const OVERLAY_STYLES = [
  'Style: OvPlain,Poppins,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8F000000,-1,0,0,0,100,100,0,0,1,0,2,5,0,0,0,1',
  'Style: OvOutline,Poppins,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,5,0,0,0,1',
  'Style: OvBox,Poppins,48,&H00FFFFFF,&H00FFFFFF,&HFF000000,&H26000000,-1,0,0,0,100,100,0,0,4,12,0,5,0,0,0,1'
]

/** One Dialogue line per text overlay, placed with \an (anchor) and \pos like the editor preview. */
function overlayEvents(texts: TextOverlay[], total: number, w: number, h: number): string[] {
  const out: string[] = []
  for (const o of texts) {
    const end = overlayEnd(o, total)
    if (end <= o.start || !o.text.trim()) continue
    const px = o.size * h
    const fs = Math.max(8, Math.round(px * POPPINS_CELL))
    const fx = textEffects(o.style, px)
    const style = o.style === 'box' ? 'OvBox' : o.style === 'outline' ? 'OvOutline' : 'OvPlain'
    const tags = [
      `\\an${o.anchor}`,
      `\\pos(${Math.round(o.x * w)},${Math.round(o.y * h)})`,
      '\\q2',
      `\\fs${fs}`,
      o.bold ? '\\fnPoppins\\b1' : '\\fnPoppins Medium\\b0',
      `\\c${assInlineColor(o.color)}`
    ]
    if (o.style === 'box') tags.push(`\\bord${fx.pad}`, `\\4c${assInlineColor(contrastColor(o.color))}`, '\\4a&H26&')
    if (o.style === 'outline') tags.push(`\\bord${fx.outline}`, `\\3c${assInlineColor(contrastColor(o.color))}`)
    if (o.style === 'plain') tags.push('\\bord0', `\\shad${fx.shadow}`)
    const text = escapeAss(o.text).replace(/\r?\n/g, '\\N')
    out.push(`Dialogue: 2,${assTime(o.start)},${assTime(end)},${style},,0,0,0,,{${tags.join('')}}${text}`)
  }
  return out
}

/** The subtitle file burned into the video: optional captions (box on layer 0, text on 1) and overlay text above them (layer 2). */
function buildAss(captions: CaptionTrack | null, texts: TextOverlay[], total: number, w: number, h: number): string {
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...(captions ? captionStyleLines(captions, w, h) : []),
    ...OVERLAY_STYLES,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...(captions ? captionEvents(captions, w, h) : []),
    ...overlayEvents(texts, total, w, h)
  ]
  return lines.join('\n') + '\n'
}

/** Caption size in pixels (one em), the vertical margin and the box padding for a frame of height h. */
function captionMetrics({ style, sizeScale }: CaptionTrack, h: number): { px: number; marginV: number; pad: number } {
  const px = style.size * h * sizeScale
  return { px, marginV: Math.round(h * 0.07), pad: style.box ? px * CAPTION_BOX_PAD : 0 }
}

function captionStyleLines(track: CaptionTrack, w: number, h: number): string[] {
  const { style, pos } = track
  // Poppins comes in several weight files; the other caption fonts have a single one.
  const font = style.fontInfo.id === 'poppins' ? (FONT_BY_WEIGHT[style.weight] ?? FONT_BY_WEIGHT[700]) : { name: style.fontInfo.family, bold: 0 }
  const { px, marginV } = captionMetrics(track, h)
  const size = Math.round(px * style.fontInfo.cell)
  const boxed = !!style.box
  const align = pos === 'atas' ? 8 : pos === 'tengah' ? 5 : 2
  // A boxed caption is plain text over its own rounded box (CapBox); libass can only draw square boxes.
  const outline = baseOutline(style, h)
  const outlineColor = boxed ? '&HFF000000' : assColor(style.outlineColor)
  const side = Math.round((w * (1 - CAPTION_MAX_WIDTH)) / 2)
  const lines = [
    `Style: Cap,${font.name},${size},${assColor(style.color)},${assColor(style.color)},${outlineColor},&HFF000000,${font.bold},0,0,0,100,100,0,0,1,${outline},0,${align},${side},${side},${marginV},1`
  ]
  if (boxed) lines.push(`Style: CapBox,${font.name},${size},${assColor(style.box!, style.boxAlpha)},&H00FFFFFF,&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`)
  if (style.pill) lines.push(`Style: CapPill,${font.name},${size},${assColor(style.highlight)},&H00FFFFFF,&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`)
  return lines
}

function baseOutline(style: ResolvedCaption, h: number): number {
  return style.box ? 0 : Math.max(1, Math.round(style.outline * h))
}

function captionEvents(track: CaptionTrack, w: number, h: number): string[] {
  const { chunks, style, pos } = track
  const { px, marginV, pad } = captionMetrics(track, h)
  const measure = fontMeasure(join(fontsDir(), captionFontFile(style)))
  const lineH = px * style.fontInfo.cell
  const lines: string[] = []
  const hl = assInlineColor(style.highlight)
  const highlight = style.highlight.toLowerCase() !== style.color.toLowerCase()
  chunks.forEach((c, i) => {
    const next = chunks[i + 1]
    const holdUntil = next ? Math.min(next.start, c.end + 0.6) : c.end + 0.6
    const shown = c.words.map((x) => displayWord(x.text, style))
    // The same line breaks as the preview, written out so libass does not wrap on its own.
    const measurePx = (t: string): number => measure(t) * px
    const extraGap = (a: string, b: string): number => (style.popScale ? captionWordGap(a, b, measurePx, px, !!style.pill) : 0)
    const layout = layoutCaptionLines(shown, measurePx, w * CAPTION_MAX_WIDTH, extraGap)
    const breaks = new Set<number>()
    let count = 0
    for (const l of layout.slice(0, -1)) breaks.add((count += l.length))
    const words = shown.map((t) => escapeAss(t))
    const textOf = (color: (k: number) => string): string => words.map((_, k) => {
      if (k === 0) return color(k)
      if (breaks.has(k)) return `\\N${color(k)}`
      const gap = extraGap(shown[k - 1], shown[k])
      const gapTag = gap > 0 ? `{\\fsp${gap.toFixed(2)}} {\\fsp0}` : ' '
      return `${gapTag}${color(k)}`
    }).join('')

    if (style.box) {
      const textW = Math.max(...layout.map((l) => measure(l.join(' ')) * px))
      const textH = layout.length * lineH
      const top = pos === 'atas' ? marginV : pos === 'tengah' ? (h - textH) / 2 : h - marginV - textH
      const path = roundedRectPath(w / 2 - textW / 2 - pad, top - pad, w / 2 + textW / 2 + pad, top + textH + pad, px * CAPTION_BOX_RADIUS)
      lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(holdUntil)},CapBox,,0,0,0,,{\\an7\\pos(0,0)\\p1}${path}`)
    }
    if (!highlight) {
      lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(holdUntil)},Cap,,0,0,0,,${textOf((k) => words[k])}`)
      return
    }
    c.words.forEach((wd, j) => {
      const start = j === 0 ? c.start : wd.start
      const end = j + 1 < c.words.length ? c.words[j + 1].start : holdUntil
      if (end <= start) return
      let lineIndex = 0
      let lineStart = 0
      for (let l = 0; l < layout.length; l++) {
        if (j < lineStart + layout[l].length) { lineIndex = l; break }
        lineStart += layout[l].length
      }
      const line = layout[lineIndex]
      const wordInLine = j - lineStart
      // Each word after the first is preceded by a space and its pop gap, as libass lays out the base line.
      const advance = (word: string, k: number): number => measurePx(word) + (k ? measurePx(' ') + extraGap(line[k - 1], word) : 0)
      const lineWidth = line.reduce((sum, word, k) => sum + advance(word, k), 0)
      const before = line.slice(0, wordInLine + 1).reduce((sum, word, k) => sum + advance(word, k), 0) - measurePx(line[wordInLine])
      const wordWidth = measurePx(shown[j])
      const centerX = Math.round((w - lineWidth) / 2 + before + wordWidth / 2)
      const blockH = layout.length * lineH
      const top = pos === 'atas' ? marginV : pos === 'tengah' ? (h - blockH) / 2 : h - marginV - blockH
      const centerY = Math.round(top + lineIndex * lineH + lineH / 2)
      const activeText = words[j]
      const startScale = style.popScale ? '\\fscx100\\fscy100' : ''
      const transform = style.popScale ? `\\t(0,${CAPTION_POP_DURATION_MS},\\fscx${Math.round(CAPTION_ACTIVE_SCALE * 100)}\\fscy${Math.round(CAPTION_ACTIVE_SCALE * 100)})` : ''
      if (style.glowColor) {
        // The halo is isolated from the fixed-width base line, so it cannot move neighboring words.
        const glowPx = Math.max(2, Math.round(px * CAPTION_GLOW_OUTLINE_RATIO))
        const glowTag = `\\1a&HFF&\\3a&H30&\\4a&HFF&\\3c${assInlineColor(style.glowColor)}\\bord${glowPx}\\blur${Math.round(glowPx * CAPTION_GLOW_BLUR_RATIO)}`
        lines.push(
          `Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,{\\an5\\pos(${centerX},${centerY})${glowTag}${startScale}${transform}}${activeText}`
        )
      }
      const activeColor = style.pill ? assInlineColor('#000000') : hl
      if (style.pill) {
        const boxW = Math.round(wordWidth + 2 * px * CAPTION_PILL_PAD_EM)
        const boxH = Math.round(lineH)
        const radius = Math.round(px * CAPTION_BOX_RADIUS)
        const path = roundedRectPath(0, 0, boxW, boxH, radius)
        // Centred on the word and popped with it, as the preview scales the capsule together with its word.
        lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},CapPill,,0,0,0,,{\\an5\\pos(${centerX},${centerY})\\p1\\bord0\\shad0\\1c${assInlineColor(style.highlight)}${startScale}${transform}}${path}{\\p0}`)
      }
      // The whole line stays in place; only the active word is hidden here and drawn on top at full size.
      const inactive = textOf((k) => (k === j ? `{\\alpha&HFF&}${words[k]}{\\r}` : words[k]))
      lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${inactive}`)
      const activeTags = `\\an5\\pos(${centerX},${centerY})\\c${activeColor}${startScale}`
      lines.push(
        `Dialogue: 2,${assTime(start)},${assTime(end)},Cap,,0,0,0,,{${activeTags}${transform}}${activeText}`
      )
    })
  })
  return lines
}

function buildSrt(chunks: CaptionChunk[]): string {
  return (
    chunks
      .map((c, i) => {
        const next = chunks[i + 1]
        const end = next ? Math.min(next.start, c.end + 0.6) : c.end + 0.6
        return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(end)}\n${c.words.map((w) => w.text).join(' ')}\n`
      })
      .join('\n') + '\n'
  )
}

/** Joins overlapping clip segments in bounded blocks, sharing the boundary clip between neighboring blocks. */
async function renderVideoBlocks(files: string[], segs: Segment[], opts: ExportOptions, tmp: string, signal: AbortSignal, progress: (fraction: number) => void): Promise<string> {
  const blocks: string[] = []
  const last = segs.length - 1
  const boundaries: { start: number; end: number; trimStart: number; trimEnd: number }[] = []
  for (let start = 0; start <= last; ) {
    const end = Math.min(last, start + 19)
    const trimStart = start ? segs[start - 1].overlap : 0
    // A middle block stops right after the transition into its shared last clip; the next block starts there.
    const lead = segs.slice(start, end).reduce((n, s) => n + s.own, 0)
    const trimEnd = end === last ? lead + segs[end].own : lead + segs[end - 1].overlap
    boundaries.push({ start, end, trimStart, trimEnd })
    if (end === last) break
    start = end
  }
  for (let bi = 0; bi < boundaries.length; bi++) {
    const b = boundaries[bi]
    const graph: string[] = []
    for (let i = b.start; i <= b.end; i++) graph.push('-i', files[i])
    const filters: string[] = []
    let v = '[0:v]'
    let offset = 0
    for (let i = b.start; i < b.end; i++) {
      offset += segs[i].own
      const label = `[x${i - b.start}]`
      filters.push(`${v}[${i - b.start + 1}:v]xfade=transition=${segs[i].transition}:duration=${segs[i].overlap.toFixed(6)}:offset=${offset.toFixed(6)}${label}`)
      v = label
    }
    filters.push(`${v}trim=start=${b.trimStart.toFixed(6)}:end=${b.trimEnd.toFixed(6)},setpts=PTS-STARTPTS[vout]`)
    const graphFile = `video-block-${bi}.txt`
    writeFileSync(join(tmp, graphFile), filters.join(';\n'), 'utf8')
    const out = `video-block-${bi}.mp4`
    const args: string[] = []
    for (let i = b.start; i <= b.end; i++) args.push('-i', files[i])
    const encoder = opts.encoder === 'nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', opts.resolution === 2160 ? '20' : '19', '-b:v', '0']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17']
    await runFfmpeg([
      ...args, '-filter_complex_script', graphFile, '-map', '[vout]', '-an', ...encoder,
      '-pix_fmt', 'yuv420p', '-r', String(opts.fps), '-t', Math.max(0.04, b.trimEnd - b.trimStart).toFixed(6), out
    ], tmp, signal)
    blocks.push(out)
    progress((bi + 1) / boundaries.length)
  }
  if (blocks.length === 1) return blocks[0]
  writeFileSync(join(tmp, 'video-list.txt'), blocks.map((f) => `file '${f}'`).join('\n') + '\n', 'utf8')
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', 'video-list.txt', '-c', 'copy', 'video-joined.mp4'], tmp, signal)
  return 'video-joined.mp4'
}

let nvencCache: boolean | null = null
let nvencCheck: Promise<boolean> | null = null

export function nvencAvailable(): Promise<boolean> {
  if (nvencCache != null) return Promise.resolve(nvencCache)
  if (nvencCheck) return nvencCheck
  nvencCheck = (async () => {
    let tmp = ''
    try {
      const encoders = execFileSync(ffmpegPath(), ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      if (!/\bh264_nvenc\b/.test(encoders)) return (nvencCache = false)
      tmp = join(dataDir(), 'tmp', `nvenc-check-${Date.now()}`)
      mkdirSync(tmp, { recursive: true })
      // Tiny frames are rejected by NVENC even when the GPU and driver are available.
      await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=1:d=1', '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], tmp, new AbortController().signal)
      return (nvencCache = true)
    } catch {
      return (nvencCache = false)
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true })
      nvencCheck = null
    }
  })()
  return nvencCheck
}

/**
 * Seconds each audio window is mixed ahead of its own start and then cut away, so the ducking compressor and
 * the music fade carry over from the previous window instead of starting fresh at every boundary.
 */
const AUDIO_PREROLL_SEC = 3

/** Mixes short timeline windows independently so long projects never open hundreds of audio inputs at once. */
async function renderAudioMix(
  bundle: ProjectBundle,
  segs: Segment[],
  total: number,
  duck: boolean,
  tmp: string,
  signal: AbortSignal,
  progress: (fraction: number) => void
): Promise<string> {
  const projectId = bundle.project.id
  const editor = bundle.project.editor
  const music = assetOf(bundle, editor.musicAssetId)
  const sfx = (editor.sfx ?? []).filter((item) => item.durationMs > 0 && assetOf(bundle, item.assetId))
  const windowSec = 30
  const count = Math.max(1, Math.ceil(total / windowSec))
  const outputs: string[] = []
  for (let block = 0; block < count; block++) {
    const from = block * windowSec
    const length = Math.min(windowSec, total - from)
    const to = from + length
    const pre = Math.min(AUDIO_PREROLL_SEC, from)
    const mixFrom = from - pre
    // Delays in samples (48 kHz), so a sound split across two windows joins without a gap or overlap.
    const delayTo = (at: number): string => {
      const n = Math.max(0, Math.round((at - mixFrom) * 48000))
      return `adelay=${n}S|${n}S`
    }
    const args: string[] = []
    const graph: string[] = []
    const voices: string[] = []
    let index = 0
    segs.forEach((seg, i) => {
      const audio = assetOf(bundle, seg.clip.audioAssetId)
      if (!audio) return
      const span = voiceSpan(seg.clip, audio.durationMs ?? UNKNOWN_AUDIO_MS)
      const voiceStart = seg.start + span.startMs / 1000
      const voiceEnd = voiceStart + span.playMs / 1000
      const start = Math.max(mixFrom, voiceStart)
      const end = Math.min(to, voiceEnd)
      if (end <= start) return
      args.push('-i', assetAbsPath(projectId, audio.localPath))
      const sourceStart = span.inMs / 1000 + start - voiceStart
      const playLength = end - start
      const clippedByVoiceWindow = end >= voiceEnd && span.playMs < span.lengthMs
      const fade = clippedByVoiceWindow ? `,afade=t=out:st=${Math.max(0, playLength - 0.06).toFixed(3)}:d=${Math.min(0.06, playLength).toFixed(3)}` : ''
      const db = (editor.voiceVolumeDb ?? 0) + (seg.clip.voiceGainDb ?? 0)
      const gain = Math.abs(db) > 0.01 ? `,volume=${db.toFixed(2)}dB` : ''
      graph.push(`[${index}:a]atrim=start=${sourceStart.toFixed(6)}:duration=${playLength.toFixed(6)},asetpts=PTS-STARTPTS${fade},aresample=48000,aformat=channel_layouts=stereo${gain},${delayTo(start)}[v${i}]`)
      voices.push(`[v${i}]`)
      index++
    })
    let voiceOut: string | null = null
    if (voices.length === 1) voiceOut = voices[0]
    else if (voices.length > 1) {
      graph.push(`${voices.join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0[voice]`)
      voiceOut = '[voice]'
    }
    let musicOut: string | null = null
    if (music) {
      const span = musicSpan(editor, total)
      const start = Math.max(mixFrom, span.startSec)
      const end = Math.min(to, span.endSec)
      if (end > start) {
        args.push('-stream_loop', '-1', '-i', assetAbsPath(projectId, music.localPath))
        const sourceStart = span.inSec + start - span.startSec
        const elapsedAtEnd = end - span.startSec
        const fadeStart = Math.max(0, span.endSec - span.startSec - 2)
        const fade = end >= span.endSec && elapsedAtEnd > fadeStart ? `,afade=t=out:st=${Math.max(0, fadeStart - (start - span.startSec)).toFixed(3)}:d=${Math.min(2, elapsedAtEnd - fadeStart).toFixed(3)}` : ''
        graph.push(`[${index}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${sourceStart.toFixed(6)}:duration=${(end - start).toFixed(6)},asetpts=PTS-STARTPTS,volume=${editor.musicVolumeDb}dB${fade},${delayTo(start)}[mus]`)
        musicOut = '[mus]'
        index++
      }
    }
    if (voiceOut && musicOut && duck) {
      graph.push(`${voiceOut}asplit=2[v1][v2]`)
      graph.push(`${musicOut}[v2]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[duck]`)
      graph.push('[v1][duck]amix=inputs=2:normalize=0:dropout_transition=0[vmix]')
      voiceOut = '[vmix]'
      musicOut = null
    }
    let mix: string | null = voiceOut
    if (musicOut) {
      if (mix) {
        graph.push(`${mix}${musicOut}amix=inputs=2:normalize=0:dropout_transition=0[vmix]`)
        mix = '[vmix]'
      } else mix = musicOut
    }
    const effects: string[] = []
    sfx.forEach((item, i) => {
      const startAt = item.startMs / 1000
      const endAt = startAt + item.durationMs / 1000
      const start = Math.max(mixFrom, startAt)
      const end = Math.min(to, endAt)
      if (end <= start) return
      const asset = assetOf(bundle, item.assetId)!
      args.push('-i', assetAbsPath(projectId, asset.localPath))
      const sourceStart = (item.inMs ?? 0) / 1000 + start - startAt
      const db = item.volumeDb ?? 0
      const gain = Math.abs(db) > 0.01 ? `,volume=${db.toFixed(2)}dB` : ''
      graph.push(`[${index}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${sourceStart.toFixed(6)}:duration=${(end - start).toFixed(6)},asetpts=PTS-STARTPTS${gain},${delayTo(start)}[s${i}]`)
      effects.push(`[s${i}]`)
      index++
    })
    if (effects.length) {
      let effectMix = effects[0]
      if (effects.length > 1) {
        graph.push(`${effects.join('')}amix=inputs=${effects.length}:normalize=0:dropout_transition=0[smix]`)
        effectMix = '[smix]'
      }
      if (mix) {
        graph.push(`${mix}${effectMix}amix=inputs=2:normalize=0:dropout_transition=0[allmix]`)
        mix = '[allmix]'
      } else mix = effectMix
    }
    const output = `audio-${block}.wav`
    graph.push(mix
      ? `${mix}aresample=48000,apad,atrim=start=${pre.toFixed(6)}:end=${(pre + length).toFixed(6)},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo[aout]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${length.toFixed(3)},aresample=48000[aout]`)
    writeFileSync(join(tmp, `audio-${block}.txt`), graph.join(';\n'), 'utf8')
    await runFfmpeg([...args, '-filter_complex_script', `audio-${block}.txt`, '-map', '[aout]', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', output], tmp, signal)
    outputs.push(output)
    progress((block + 1) / count)
  }
  if (outputs.length === 1) return outputs[0]
  writeFileSync(join(tmp, 'audio-list.txt'), outputs.map((f) => `file '${f}'`).join('\n') + '\n', 'utf8')
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', 'audio-list.txt', '-c', 'copy', 'audio-joined.wav'], tmp, signal)
  return 'audio-joined.wav'
}

// ---------- timeline ----------

interface Segment {
  clip: Clip
  start: number
  own: number
  overlap: number
  /** Extra frames rendered past the transition, so xfade never runs out of the first clip. */
  pad: number
  transition: string
}

/**
 * Places clips on whole frames. xfade stops the whole video when the first clip ends before the transition
 * offset, which happens with a one-frame cut whose offset falls between two frames. Frame-aligned starts
 * plus two spare frames per segment keep every transition inside the footage.
 */
function planSegments(clips: Clip[], fps: number): Segment[] {
  let t = 0
  const frames = clips.map((clip) => {
    const startF = Math.round(t * fps)
    t += clip.durationMs / 1000
    return { startF, endF: Math.max(startF + 1, Math.round(t * fps)) }
  })
  return clips.map((clip, i) => {
    const { startF, endF } = frames[i]
    const last = i === clips.length - 1
    const tr = TRANSITIONS.find((x) => x.id === clip.transition)
    let overlapF = 0
    if (!last) {
      // The clip's own transition length, never longer than either clip it joins.
      const room = Math.max(1, Math.min(endF - startF, frames[i + 1].endF - frames[i + 1].startF) - 1)
      overlapF = tr?.ffmpeg ? Math.min(room, Math.max(1, Math.round(transitionSecOf(clip) * fps))) : 1
    }
    return {
      clip,
      start: startF / fps,
      own: (endF - startF) / fps,
      overlap: overlapF / fps,
      pad: last ? 0 : 2 / fps,
      transition: tr?.ffmpeg ?? 'fade'
    }
  })
}

/**
 * The size a camera move is rendered at before the final scale: the source's own detail, cropped to the frame,
 * so the move resamples real pixels once. Never below the output size, and at most twice it.
 */
function workSize(srcW: number | null | undefined, srcH: number | null | undefined, size: { w: number; h: number }): { w: number; h: number } {
  if (!srcW || !srcH) return size
  const aspect = size.w / size.h
  const cropW = srcW / srcH > aspect ? srcH * aspect : srcW
  const f = Math.min(2, Math.max(1, cropW / size.w))
  return { w: Math.round((size.w * f) / 2) * 2, h: Math.round((size.h * f) / 2) * 2 }
}

/** Scale and crop to the work size, the camera move, then down to the output size. */
function cameraChain(
  cam: string | null,
  work: { w: number; h: number },
  size: { w: number; h: number },
  between: string[] = [],
  filterStr: string | null = null
): string {
  return [
    `scale=${work.w}:${work.h}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${work.w}:${work.h}`,
    'setsar=1',
    ...between,
    ...(cam ? [cam] : []),
    ...(work.w !== size.w || work.h !== size.h ? [`scale=${size.w}:${size.h}:flags=lanczos`, 'setsar=1'] : []),
    ...(filterStr ? [filterStr] : []),
    'format=yuv420p'
  ].join(',')
}

/** An audio length to assume when an older asset never recorded its duration. */
const UNKNOWN_AUDIO_MS = 10 * 60 * 1000

function assetOf(bundle: ProjectBundle, id: string | null): Asset | undefined {
  return id ? bundle.assets.find((a) => a.id === id) : undefined
}

function segmentCacheKey(bundle: ProjectBundle, seg: Segment, opts: ExportOptions, size: { w: number; h: number }): string {
  const clip = seg.clip
  const asset = assetOf(bundle, clip.motionType === 'video' ? clip.videoAssetId : clip.imageAssetId)
  const path = asset ? assetAbsPath(bundle.project.id, asset.localPath) : ''
  const file = path && existsSync(path) ? statSync(path) : null
  return createHash('sha256').update(JSON.stringify({
    clip,
    segment: { start: seg.start, own: seg.own, overlap: seg.overlap, pad: seg.pad },
    framing: bundle.project.editor.clipFraming?.[clip.id],
    asset: asset && [asset.id, asset.localPath, asset.width, asset.height, file?.size, file?.mtimeMs],
    aspect: bundle.project.aspectRatio,
    size,
    fps: opts.fps
  })).digest('hex')
}

async function renderSegment(
  bundle: ProjectBundle,
  seg: Segment,
  index: number,
  opts: ExportOptions,
  size: { w: number; h: number },
  tmp: string,
  signal: AbortSignal
): Promise<string> {
  const { clip } = seg
  const out = `seg_${String(index).padStart(3, '0')}.mp4`
  const len = seg.own + seg.overlap + seg.pad
  const frames = Math.max(1, Math.round(len * opts.fps))
  const video = clip.motionType === 'video' ? assetOf(bundle, clip.videoAssetId) : undefined
  const enc = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(opts.fps)]
  const filterStr = filterFfmpeg(clip.filter)
  if (video) {
    const cam = cameraPerspective(clip.videoCamera, clip.videoStrength, Math.max(2, Math.round(seg.own * opts.fps)), opts.fps)
    const work = cam ? workSize(video.width, video.height, size) : size
    const vf = cameraChain(
      cam,
      work,
      size,
      [`fps=${opts.fps}`, `tpad=stop_mode=clone:stop_duration=${len.toFixed(3)}`],
      filterStr
    )
    // A video trimmed on the timeline starts that far into its file.
    const from = clip.mediaInMs > 0 ? ['-ss', (clip.mediaInMs / 1000).toFixed(3)] : []
    await runFfmpeg([...from, '-i', assetAbsPath(bundle.project.id, video.localPath), '-vf', vf, '-t', len.toFixed(3), ...enc, out], tmp, signal)
    return out
  }
  const image = assetOf(bundle, clip.imageAssetId)
  if (!image) throw new Error(`Klip ${String(index + 1).padStart(2, '0')} (“${clip.title}”) belum punya gambar.`)
  const ownFrames = Math.max(2, Math.round(seg.own * opts.fps))
  const framing = bundle.project.editor.clipFraming?.[clip.id]
  const cam = cameraPerspective(clip.cameraPreset, clip.motionStrength, ownFrames, opts.fps, framing)
  const vf = cameraChain(cam, cam ? workSize(image.width, image.height, size) : size, size, [], filterStr)
  await runFfmpeg(
    [
      '-loop',
      '1',
      '-framerate',
      String(opts.fps),
      '-t',
      len.toFixed(3),
      '-i',
      assetAbsPath(bundle.project.id, image.localPath),
      '-vf',
      vf,
      '-frames:v',
      String(frames),
      ...enc,
      out
    ],
    tmp,
    signal
  )
  return out
}

async function renderProject(ctx: TaskCtx, projectId: string, opts: ExportOptions): Promise<string> {
  if (opts.encoder === 'nvenc' && !(await nvencAvailable())) throw new Error('Encoder NVIDIA NVENC tidak tersedia. Pilih encoder CPU atau perbarui driver NVIDIA.')
  const bundle = getBundle(projectId)
  if (!bundle.clips.length) throw new Error('Proyek belum punya klip')
  const size = outputSize(bundle.project.aspectRatio, opts.resolution)
  const tmp = join(dataDir(), 'tmp', `export-${ctx.jobId}`)
  const cacheDir = join(dataDir(), 'tmp', 'export-cache', projectId)
  mkdirSync(tmp, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  try {
    const segs = planSegments(bundle.clips, opts.fps)
    const total = segs.reduce((n, s) => n + s.own, 0)
    const folder = opts.folder
    mkdirSync(folder, { recursive: true })
    const finalMbPerSec = opts.resolution === 720 ? 0.55 : opts.resolution === 1080 ? 0.95 : 3.8
    const tempMbPerSec = opts.resolution === 720 ? 1.4 : opts.resolution === 1080 ? 3.2 : 12
    const neededFinal = total * finalMbPerSec * 1_000_000 * 1.2
    const neededTemp = total * tempMbPerSec * 1_000_000 * 1.35 + 64 * 1024 * 1024
    const freeAt = (path: string): number => {
      const fs = statfsSync(path)
      return Number(fs.bavail) * Number(fs.bsize)
    }
    const outputFree = freeAt(folder)
    const tempFree = freeAt(tmp)
    if (outputFree < neededFinal) throw new Error(`Ruang disk output tidak cukup. Video sekitar ${Math.ceil(neededFinal / 1_000_000)} MB, kosongkan ruang atau pilih folder lain.`)
    const sameDrive = parse(folder).root.toLowerCase() === parse(tmp).root.toLowerCase()
    if (tempFree < neededTemp || (sameDrive && tempFree < neededTemp + neededFinal)) {
      throw new Error(`Ruang disk sementara tidak cukup. Render dan file akhir perlu sekitar ${Math.ceil((neededTemp + (sameDrive ? neededFinal : 0)) / 1_000_000)} MB. Kosongkan ruang atau pilih folder output di disk lain.`)
    }

    // 1. one silent video segment per clip, two at a time
    const files: string[] = new Array(segs.length)
    let done = 0
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < segs.length) {
        const i = next++
        const output = `seg_${String(i).padStart(3, '0')}.mp4`
        const cached = join(cacheDir, `${segmentCacheKey(bundle, segs[i], opts, size)}.mp4`)
        if (existsSync(cached)) copyFileSync(cached, join(tmp, output))
        else {
          const rendered = await renderSegment(bundle, segs[i], i, opts, size, tmp, ctx.signal)
          const partial = `${cached}.${ctx.jobId}.partial`
          copyFileSync(join(tmp, rendered), partial)
          try {
            renameSync(partial, cached)
          } catch (error) {
            if (!existsSync(cached)) throw error
            rmSync(partial, { force: true })
          }
        }
        files[i] = output
        done++
        ctx.progress(0.03 + 0.6 * (done / segs.length), `Merender klip ${done} dari ${segs.length}`)
      }
    }
    const segmentResults = await Promise.allSettled([worker(), worker()])
    const segmentFailure = segmentResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (segmentFailure) throw segmentFailure.reason

    // 2. captions
    const style = resolveCaption(bundle.project.editor)
    // Captions follow each clip's voice as trimmed and placed on the timeline.
    const chunks = timelineChunks(
      segs.map((s) => {
        const audio = assetOf(bundle, s.clip.audioAssetId)
        if (!audio) return { start: s.start, words: [] }
        const shown = clipCaptionWords(s.clip, audio.meta.words ?? [], audio.durationMs ?? UNKNOWN_AUDIO_MS)
        return { start: s.start, words: shown.words, key: audio.id, offset: shown.offset }
      })
    )
    const burn = opts.burnCaptions && !!style && chunks.length > 0
    // Overlays are part of the picture, so they are drawn even when captions are left out.
    const overlays = bundle.project.editor.overlays ?? []
    const texts = overlays.filter((o): o is TextOverlay => o.kind === 'text' && !!o.text.trim() && o.start < total)
    const images = overlays
      .filter((o): o is ImageOverlay => o.kind === 'image' && o.start < total)
      .map((o) => ({ o, asset: assetOf(bundle, o.assetId) }))
      .filter((x): x is { o: ImageOverlay; asset: Asset } => !!x.asset && existsSync(assetAbsPath(projectId, x.asset.localPath)))
    const useAss = burn || texts.length > 0
    if (useAss) {
      const captions = burn
        ? {
            chunks,
            style: style!,
            pos: bundle.project.editor.captionPosition,
            sizeScale: captionScaleOf(bundle.project.editor)
          }
        : null
      writeFileSync(join(tmp, 'captions.ass'), buildAss(captions, texts, total, size.w, size.h), 'utf8')
      mkdirSync(join(tmp, 'fonts'), { recursive: true })
      for (const f of readdirSync(fontsDir()).filter((x) => x.endsWith('.ttf'))) copyFileSync(join(fontsDir(), f), join(tmp, 'fonts', f))
    }

    let videoFile: string
    try {
      videoFile = await renderVideoBlocks(files, segs, opts, tmp, ctx.signal, (f) => ctx.progress(0.64 + 0.1 * f, `Menggabungkan blok video ${Math.round(f * 100)}%`))
    } catch (error) {
      if (opts.encoder !== 'nvenc' || ctx.signal.aborted) throw error
      ctx.progress(0.64, 'NVENC gagal; mengulang blok video dengan CPU')
      // The fallback rewrites the deterministic block names with CPU output.
      videoFile = await renderVideoBlocks(files, segs, { ...opts, encoder: 'cpu' }, tmp, ctx.signal, (f) => ctx.progress(0.64 + 0.1 * f, `Render CPU ${Math.round(f * 100)}%`))
    }
    const audioFile = await renderAudioMix(bundle, segs, total, opts.duckMusic, tmp, ctx.signal, (f) => ctx.progress(0.74 + 0.1 * f, `Mencampur audio ${Math.round(f * 100)}%`))
    const args = ['-i', videoFile, '-i', audioFile]
    const graph: string[] = []
    let v = '[0:v]'
    images.forEach(({ o, asset }, k) => {
      args.push('-i', assetAbsPath(projectId, asset.localPath))
      const iw = Math.max(2, Math.round((o.width * size.w) / 2) * 2)
      const ih = Math.max(2, Math.round((iw * (asset.height || iw)) / (asset.width || iw) / 2) * 2)
      const { ax, ay } = anchorOffset(o.anchor)
      const x = Math.round(o.x * size.w - ax * iw)
      const y = Math.round(o.y * size.h - ay * ih)
      const end = overlayEnd(o, total)
      graph.push(`[${k + 2}:v]format=rgba,scale=${iw}:${ih},colorchannelmixer=aa=${o.opacity.toFixed(2)}[ov${k}]`)
      graph.push(`${v}[ov${k}]overlay=x=${x}:y=${y}:enable='between(t,${o.start.toFixed(3)},${end.toFixed(3)})'[vo${k}]`)
      v = `[vo${k}]`
    })
    graph.push(`${v}${useAss ? 'ass=captions.ass:fontsdir=fonts,' : ''}format=yuv420p[vout]`)
    graph.push(`[1:a]${opts.normalizeAudio ? 'loudnorm=I=-14:LRA=11:TP=-1.5,' : ''}aresample=48000,apad,atrim=0:${total.toFixed(3)}[aout]`)
    writeFileSync(join(tmp, 'graph.txt'), graph.join(';\n'), 'utf8')

    const base = (opts.fileName.trim() || 'video').replace(/[<>:"/\\|?*]+/g, '-').replace(/\.mp4$/i, '')
    let outPath = join(folder, `${base}.mp4`)
    for (let n = 2; existsSync(outPath); n++) outPath = join(folder, `${base}-${n}.mp4`)

    ctx.progress(0.84, 'Menyusun video dan audio akhir')
    const finalArgs = (gpu: boolean): string[] => [
        ...args,
        '-filter_complex_script',
        'graph.txt',
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-c:v',
        ...(gpu
          ? ['h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', opts.resolution === 2160 ? '20' : '19', '-b:v', '0']
          : ['libx264', '-preset', 'medium', '-crf', opts.resolution === 2160 ? '20' : '19']),
        '-r',
        String(opts.fps),
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-movflags',
        '+faststart',
        '-t',
        total.toFixed(3),
        outPath
      ]
    const runFinal = (gpu: boolean): Promise<void> => runFfmpeg(
      finalArgs(gpu),
      tmp,
      ctx.signal,
      total,
      (f) => ctx.progress(0.84 + 0.15 * f, gpu ? 'Menyusun video akhir dengan NVENC' : 'Menyusun video dan audio akhir')
    )
    try {
      await runFinal(opts.encoder === 'nvenc')
    } catch (error) {
      if (opts.encoder !== 'nvenc' || ctx.signal.aborted) throw error
      ctx.progress(0.84, 'NVENC gagal; melanjutkan encode akhir dengan CPU')
      await runFinal(false)
    }
    if (opts.writeSrt && chunks.length) writeFileSync(outPath.replace(/\.mp4$/i, '.srt'), buildSrt(chunks), 'utf8')
    rmSync(cacheDir, { recursive: true, force: true })
    return outPath
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function clearExportCache(projectId: string): void {
  rmSync(join(dataDir(), 'tmp', 'export-cache', projectId), { recursive: true, force: true })
}

export function startExport(projectId: string, opts: ExportOptions): Job {
  const job = insertJob({ projectId, kind: 'export', provider: 'ffmpeg', payload: { ...opts } })
  emit.job(job)
  return runJob(job, 'export', async (ctx) => {
    const out = await renderProject(ctx, projectId, opts)
    touchProject(projectId, { status: 'exported' })
    return { message: out }
  })
}
