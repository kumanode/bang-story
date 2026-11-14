import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import {
  AudioLines,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Layers,
  Lock,
  Mic,
  Music,
  Plus,
  Redo2,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  X,
  ZoomIn
} from 'lucide-react'
import type { CaptionChunk } from '@shared/captions'
import { overlayEnd } from '@shared/overlays'
import { BUILTIN_SFX, planAutoSfx } from '@shared/sfx'
import { clipCaptionWords, MIN_ITEM_MS, musicSpan, voiceSpan } from '@shared/timeline'
import type { Asset, EditorSettings, Overlay, SfxItem, WordTiming } from '@shared/types'
import { cx } from '../../../components/ui'
import { errorText, timecode } from '../../../lib/format'
import { useApp } from '../../../store/app'
import { useProject } from '../../../store/project'
import { UNKNOWN_AUDIO_MS, updateOverlay, usePlayback, useTrackControls, voiceWindow, type TimelineItem } from './engine'
import { TransitionButton } from './TransitionButton'
import { Waveform } from './Waveform'

const LABEL_W = 140
/** Space between the track labels and the start of the time axis. */
const PAD = 8
const ORIGIN = LABEL_W + PAD
const ROW_GAP = 8
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120]
/** The one look for "this is what the panel is editing", on every track. */
const SELECTED = 'z-[1] ring-2 ring-accent ring-offset-1 ring-offset-surface'
/** How close (in pixels) a dragged edge has to come to the playhead or a clip joint to snap to it. */
const SNAP_PX = 8
const MAX_IMAGE_MS = 120_000

/** What was clicked on the timeline. */
export type TimelinePick =
  | { kind: 'clip'; id: string }
  | { kind: 'voice'; id: string }
  | { kind: 'caption'; chunk: CaptionChunk }
  | { kind: 'music' }
  | { kind: 'sfx'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'transition'; id: string }

/** What the inspector is editing right now, so the timeline can mark it. */
export type TimelineSelection =
  | { kind: 'clip' | 'voice' | 'overlay' | 'transition'; id: string }
  | { kind: 'caption'; key: string; from: number }
  | { kind: 'music' }
  | { kind: 'sfx'; id: string }
  | null

type Placed = { o: Overlay; start: number; end: number }

/**
 * Overlays packed into rows: each one goes into the first row that is free for its whole time, so overlays
 * that show at the same time get rows of their own instead of covering each other.
 */
export function overlayLanes(overlays: Overlay[], total: number): Placed[][] {
  const lanes: Placed[][] = []
  for (const o of overlays) {
    const start = Math.min(o.start, total)
    const end = overlayEnd(o, total)
    if (end <= start) continue
    const free = lanes.find((lane) => lane.every((x) => x.end <= start + 1e-6 || x.start >= end - 1e-6))
    if (free) free.push({ o, start, end })
    else lanes.push([{ o, start, end }])
  }
  return lanes
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const secs = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} dtk`
const r2 = (s: number): number => Math.round(s * 100) / 100

/**
 * A caption chunk moved or stretched on the timeline, written back to its voice's word list: every word in
 * the chunk is mapped from the old span onto the new one, the other words stay.
 */
function retimedWords(all: WordTiming[], c: CaptionChunk, start: number, end: number): WordTiming[] {
  const src = c.source!
  const scale = c.end > c.start ? (end - start) / (c.end - c.start) : 1
  const map = (t: number): number => start + (t - c.start) * scale
  const out = [...all]
  c.words.forEach((w, i) => {
    const k = src.from + i
    const orig = all[k]
    if (!orig) return
    out[k] = { ...orig, start: Math.max(0, orig.start + (map(w.start) - w.start)), end: Math.max(0, orig.end + (map(w.end) - w.end)) }
  })
  return out
}

function Playhead({ pps }: { pps: number }) {
  const t = usePlayback((s) => s.t)
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-accent" style={{ left: ORIGIN + t * pps }}>
      <span className="absolute -left-[6px] -top-0.5 size-3.5 rounded-[3px] border-[1.5px] border-ink bg-accent" />
    </div>
  )
}

/** One track: a label that stays put while the timeline scrolls sideways, and the items on the time axis. */
function Row({
  label,
  icon,
  height,
  action,
  onDrop,
  onDragOver,
  trackId,
  children
}: {
  label: string
  icon?: ReactNode
  height: number
  action?: ReactNode
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  trackId?: string
  children?: ReactNode
}) {
  return (
    <div className="flex" style={{ height: height + ROW_GAP }}>
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center justify-between gap-1 bg-surface pl-4 pr-2 text-[13px] font-semibold"
        style={{ width: LABEL_W, marginRight: PAD, height }}
      >
        <div className="flex min-w-0 items-center gap-1.5 truncate">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        {action}
        {trackId && <button type="button" aria-label={`${useTrackControls.getState().lockedTracks[trackId] ? 'Buka kunci' : 'Kunci'} track ${label}`} title={useTrackControls.getState().lockedTracks[trackId] ? 'Buka kunci track' : 'Kunci track'} onClick={(e) => { e.stopPropagation(); useTrackControls.getState().toggleTrackLock(trackId) }} className="flex size-5 items-center justify-center rounded text-muted hover:bg-sand-2 hover:text-ink">{useTrackControls.getState().lockedTracks[trackId] ? <Lock className="size-3.5 text-accent-dark" /> : <Unlock className="size-3.5" />}</button>}
      </div>
      <div className="relative flex-1 self-start" style={{ height }} data-track-locked={trackId && useTrackControls.getState().lockedTracks[trackId] ? 'true' : 'false'} onDrop={onDrop} onDragOver={onDragOver}>
        {children}
      </div>
    </div>
  )
}

type Mode = 'move' | 'left' | 'right'

/** What an item does under the pointer: a press without movement picks it; a drag moves or trims it. */
interface DragSpec {
  click(): void
  /** Starts a drag; returns what each move does (seconds moved; returns the label to show) and how it ends. */
  begin(mode: Mode): { move(d: number): string; end?(): void } | null
}

export function Timeline({
  items,
  chunks,
  music,
  total,
  editor,
  assets,
  selection,
  onPick,
  canSplit,
  canDelete,
  onSplit,
  onDelete
}: {
  items: TimelineItem[]
  chunks: CaptionChunk[]
  music: Asset | null
  total: number
  editor: EditorSettings
  assets: Record<string, Asset>
  selection: TimelineSelection
  onPick: (pick: TimelinePick) => void
  canSplit: boolean
  canDelete: boolean
  onSplit: () => void
  onDelete: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [zoom, setZoom] = useState(1)
  const seek = usePlayback((s) => s.seek)
  const project = useProject((s) => s.project)
  const updateClip = useProject((s) => s.updateClip)
  const updateEditor = useProject((s) => s.updateEditor)
  const undo = useProject((s) => s.undo)
  const redo = useProject((s) => s.redo)
  const canUndo = useProject((s) => s.canUndo)
  const canRedo = useProject((s) => s.canRedo)
  const { voiceMuted, musicMuted, sfxMuted, captionsHidden, overlaysHidden, lockedTracks, toggleVoiceMute, toggleMusicMute, toggleSfxMute, toggleCaptionsHide, toggleOverlaysHide } =
    useTrackControls()
  const { toast } = useApp()
  const [showSfxMenu, setShowSfxMenu] = useState(false)

  const addBuiltinSfx = async (sfxId: string) => {
    if (!project) return
    setShowSfxMenu(false)
    try {
      const asset = await window.api.assets.addBuiltinSfx(project.id, sfxId)
      useProject.getState().addAsset(asset)
      const currentT = usePlayback.getState().t
      const sfxItem: SfxItem = {
        id: crypto.randomUUID(),
        assetId: asset.id,
        name: asset.prompt ?? 'SFX',
        startMs: Math.round(currentT * 1000),
        durationMs: asset.durationMs ?? 1000,
        volumeDb: 0
      }
      updateEditor({ sfx: [...(project.editor.sfx ?? []), sfxItem] })
      toast('info', `SFX "${sfxItem.name}" ditambahkan pada ${timecode(currentT)}`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const addAutoSfx = async (): Promise<void> => {
    if (!project || lockedTracks.sfx) return
    setShowSfxMenu(false)
    const cues = planAutoSfx(
      items.map((it) => ({
        startSec: it.start,
        endSec: it.end,
        text: [it.clip.story, it.clip.narration, it.clip.visualPrompt].join(' '),
        words: it.audio
          ? clipCaptionWords(it.clip, it.audio.meta.words ?? [], it.audio.durationMs ?? UNKNOWN_AUDIO_MS).words.map((w) => ({
              text: w.text,
              start: it.start + w.start
            }))
          : [],
        transition: it.clip.transition
      })),
      total
    )
    if (!cues.length) {
      toast('info', 'Tidak ada adegan yang cocok untuk efek suara otomatis. Coba tambahkan SFX manual.')
      return
    }
    try {
      // One asset per effect, reused across cues and later runs, instead of a file copy per cue.
      const byId = new Map<string, Asset>()
      for (const id of new Set(cues.map((c) => c.sfxId))) {
        const def = BUILTIN_SFX.find((s) => s.id === id)!
        let asset = Object.values(useProject.getState().assets).find((a) => a.kind === 'sfx' && a.provider === 'builtin' && a.prompt === def.name)
        if (!asset) {
          asset = await window.api.assets.addBuiltinSfx(project.id, id)
          useProject.getState().addAsset(asset)
        }
        byId.set(id, asset)
      }
      const placed: SfxItem[] = cues.map((c) => {
        const asset = byId.get(c.sfxId)!
        return {
          id: crypto.randomUUID(),
          assetId: asset.id,
          name: asset.prompt ?? 'SFX',
          startMs: c.startMs,
          durationMs: Math.min(asset.durationMs ?? 1000, Math.max(100, Math.round(total * 1000) - c.startMs)),
          inMs: 0,
          volumeDb: c.volumeDb,
          auto: true
        }
      })
      const assetsState = useProject.getState().assets
      const manual = (useProject.getState().project?.editor.sfx ?? []).filter((s) => {
        if (!s.auto) return true
        const asset = assetsState[s.assetId]
        // SFX berbayar ElevenLabs dan file lokal jangan pernah terhapus oleh SFX otomatis bawaan
        return asset && asset.provider !== 'builtin'
      })
      updateEditor({ sfx: [...manual, ...placed] })
      toast('info', `${placed.length} efek suara otomatis dipasang. Jalankan lagi untuk menyusun ulang; SFX manual tidak diubah.`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const addCustomSfx = async () => {
    if (!project) return
    setShowSfxMenu(false)
    try {
      const asset = await window.api.assets.pickSfx(project.id)
      if (!asset) return
      useProject.getState().addAsset(asset)
      const currentT = usePlayback.getState().t
      const sfxItem: SfxItem = {
        id: crypto.randomUUID(),
        assetId: asset.id,
        name: asset.prompt ?? 'SFX',
        startMs: Math.round(currentT * 1000),
        durationMs: asset.durationMs ?? 1000,
        volumeDb: 0
      }
      updateEditor({ sfx: [...(project.editor.sfx ?? []), sfxItem] })
      toast('info', `SFX "${sfxItem.name}" ditambahkan pada ${timecode(currentT)}`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const dropSfx = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault()
    if (!project || lockedTracks.sfx) return
    const files = [...e.dataTransfer.files].filter((file) => /\.(wav|mp3|ogg|m4a)$/i.test(file.name))
    if (!files.length) return
    for (const file of files) {
      try {
        const asset = await window.api.assets.importSfx(project.id, window.api.assets.getPathForFile(file))
        useProject.getState().addAsset(asset)
        const current = useProject.getState().project?.editor.sfx ?? []
        const startMs = Math.round(usePlayback.getState().t * 1000)
        const item: SfxItem = { id: crypto.randomUUID(), assetId: asset.id, name: asset.prompt ?? file.name, startMs, durationMs: asset.durationMs ?? 1000, inMs: 0, volumeDb: 0 }
        useProject.getState().updateEditor({ sfx: [...current, item] })
      } catch (error) {
        toast('error', errorText(error))
      }
    }
  }

  const removeSfx = (id: string) => {
    if (lockedTracks.sfx) return
    if (!project) return
    const updated = (project.editor.sfx ?? []).filter((s) => s.id !== id)
    updateEditor({ sfx: updated })
  }

  const startSfxDrag = (e: React.PointerEvent, sfxItem: SfxItem, mode: Mode = 'move') => {
    e.stopPropagation()
    if (lockedTracks.sfx) return
    const startX = e.clientX
    const initStart = sfxItem.startMs
    const initIn = sfxItem.inMs ?? 0
    const initDuration = sfxItem.durationMs
    let moved = false
    const snapMs = (ms: number): number => {
      const candidates = [0, total * 1000, usePlayback.getState().t * 1000, ...items.flatMap((it) => [it.start * 1000, it.end * 1000])]
      const near = candidates.find((x) => Math.abs(x - ms) <= SNAP_PX / pps * 1000)
      return Math.round(near ?? ms)
    }
    const onMove = (ev: globalThis.PointerEvent) => {
      const deltaMs = ((ev.clientX - startX) / pps) * 1000
      if (Math.abs(deltaMs) > 3 && !moved) {
        moved = true
        useProject.getState().beginHistoryGesture()
      }
      if (!moved) return
      const updated = (project?.editor.sfx ?? []).map((x) => {
        if (x.id !== sfxItem.id) return x
        if (mode === 'left') {
          const delta = clamp(snapMs(initStart + deltaMs) - initStart, -initIn, initDuration - MIN_ITEM_MS)
          return { ...x, startMs: initStart + delta, inMs: initIn + delta, durationMs: initDuration - delta }
        }
        if (mode === 'right') {
          // Past the end of its file a sound effect is only silence, so the block stops where the sound does.
          const fileMs = assets[sfxItem.assetId]?.durationMs
          const soundEnd = fileMs ? initStart + fileMs - initIn : Infinity
          const end = clamp(snapMs(initStart + initDuration + deltaMs), initStart + MIN_ITEM_MS, Math.max(initStart + MIN_ITEM_MS, Math.min(total * 1000, soundEnd)))
          return { ...x, durationMs: end - initStart }
        }
        const newStart = clamp(snapMs(initStart + deltaMs), 0, Math.max(0, total * 1000 - initDuration))
        return { ...x, startMs: newStart }
      })
      useProject.getState().applyEditor({ sfx: updated })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) useProject.getState().endHistoryGesture()
      if (!moved) pick({ kind: 'sfx', id: sfxItem.id }, sfxItem.startMs / 1000)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  // While dragging, the scale stays as it was when the drag began, so a clip that grows does not shrink the view.
  const [frozenPps, setFrozenPps] = useState<number | null>(null)
  const [badge, setBadge] = useState<{ x: number; y: number; text: string } | null>(null)
  const [capDrag, setCapDrag] = useState<{ key: string; from: number; start: number; end: number } | null>(null)
  const drag = useRef<{ x: number; mode: Mode; spec: DragSpec; pps: number; moved: boolean; session: ReturnType<DragSpec['begin']> } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    let lastWidth = el.clientWidth
    setWidth(lastWidth)
    const ro = new ResizeObserver(() => {
      const next = el.clientWidth
      if (Math.abs(next - lastWidth) <= 1) return
      lastWidth = next
      setWidth(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pps = frozenPps ?? Math.max(2, (Math.floor(width - ORIGIN - (zoom === 1 ? 28 : 16)) / Math.max(total, 1)) * zoom)
  const visibleFrom = Math.max(0, (scrollLeft - 900 - ORIGIN) / pps)
  const visibleTo = (scrollLeft + width + 900 - ORIGIN) / pps
  const visibleItems = items.filter((it) => it.end >= visibleFrom && it.start <= visibleTo)
  const visibleTransitions = items.slice(1).map((it, i) => ({ it, before: items[i] })).filter(({ it }) => it.start >= visibleFrom && it.start <= visibleTo)
  const visibleChunks = chunks.filter((c) => c.end >= visibleFrom && c.start <= visibleTo)
  const visibleSfx = (editor.sfx ?? []).filter((s) => s.startMs / 1000 + s.durationMs / 1000 >= visibleFrom && s.startMs / 1000 <= visibleTo)
  const step = TICK_STEPS.find((s) => s * pps >= 70) ?? 120
  const ticks: number[] = []
  for (let s = 0; s <= total + 0.001; s += step) ticks.push(s)
  const lanes = overlayLanes(editor.overlays ?? [], total)
  const ms = musicSpan(editor, total)

  // Edges snap to the playhead and to the joints between clips.
  const joints = [0, total, ...items.map((it) => it.end)]
  const snap = (sec: number, withJoints = true): number => {
    const tol = SNAP_PX / (drag.current?.pps ?? pps)
    let best = sec
    let bestD = tol
    for (const p of [usePlayback.getState().t, ...(withJoints ? joints : [])]) {
      const d = Math.abs(p - sec)
      if (d < bestD) {
        best = p
        bestD = d
      }
    }
    return best
  }

  const seekFrom = (e: PointerEvent<HTMLDivElement>): void => {
    const el = scroller.current!
    const x = e.clientX - el.getBoundingClientRect().left
    if (x < LABEL_W) return
    seek(Math.min(total, Math.max(0, (x + el.scrollLeft - ORIGIN) / pps)))
  }

  const is = (kind: string, id?: string): boolean => !!selection && selection.kind === kind && (id === undefined || ('id' in selection && selection.id === id))
  const pick = (p: TimelinePick, at?: number): void => {
    if (at !== undefined) seek(Math.min(total, Math.max(0, at)))
    onPick(p)
  }

  const finish = (cancel: boolean): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      if (!cancel) d.session?.end?.()
      useProject.getState().endHistoryGesture()
      setFrozenPps(null)
      setBadge(null)
    } else if (!cancel) d.spec.click()
  }
  const on = (spec: DragSpec, mode: Mode) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.stopPropagation()
      if (e.currentTarget.closest('[data-track-locked="true"]')) { e.preventDefault(); return }
      if (e.button !== 0) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Without capture the drag still follows the pointer while it stays over the item.
      }
      drag.current = { x: e.clientX, mode, spec, pps, moved: false, session: null }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      if (!d.moved) {
        if (Math.abs(dx) < 4) return
        d.moved = true
        useProject.getState().beginHistoryGesture()
        d.session = d.spec.begin(d.mode)
        setFrozenPps(d.pps)
      }
      const text = d.session?.move(dx / d.pps)
      if (text) setBadge({ x: e.clientX, y: e.clientY, text })
    },
    onPointerUp: () => finish(false),
    onPointerCancel: () => finish(true)
  })
  /** The two trim handles on an item's edges, with a grip that shows on hover and while the item is selected. */
  const edges = (spec: DragSpec, label: string, selected: boolean): ReactNode =>
    (['left', 'right'] as const).map((side) => (
      <span
        key={side}
        {...on(spec, side)}
        title={`Tarik untuk mengatur ${side === 'left' ? 'awal' : 'akhir'} ${label}`}
        className={cx(
          'group/edge absolute inset-y-0 z-[4] flex w-2.5 cursor-ew-resize items-center justify-center hover:bg-ink/20',
          side === 'left' ? 'left-0 rounded-l-[inherit]' : 'right-0 rounded-r-[inherit]'
        )}
      >
        <span className={cx('h-1/2 max-h-6 w-[3px] rounded-full bg-ink/70 transition-opacity', selected ? 'opacity-100' : 'opacity-0 group-hover/edge:opacity-100')} />
      </span>
    ))

  // ---- clips: the right edge sets the length, the left edge trims the start (a video starts later in its file) ----
  const clipSpec = (it: TimelineItem): DragSpec => ({
    click: () => pick({ kind: 'clip', id: it.clip.id }, it.start),
    begin: (mode) => {
      if (mode === 'move') return null
      const dur0 = it.clip.durationMs
      const in0 = it.clip.mediaInMs ?? 0
      const videoMs = it.clip.motionType === 'video' && it.video?.durationMs ? it.video.durationMs : null
      return {
        move: (d) => {
          if (mode === 'right') {
            // A video can be shortened, but never made longer than what is left of it.
            const max = videoMs ? Math.max(videoMs - in0, dur0) : MAX_IMAGE_MS
            const dur = clamp(Math.round((snap(it.start + dur0 / 1000 + d, false) - it.start) * 1000), MIN_ITEM_MS, max)
            updateClip(it.clip.id, { durationMs: dur })
            return videoMs && dur >= videoMs - in0 ? `${secs(dur)} · batas panjang video` : secs(dur)
          }
          // The clip stays joined to the one before it, so its start edge shortens or lengthens it.
          if (videoMs) {
            const mediaIn = clamp(in0 + Math.round(d * 1000), 0, videoMs - MIN_ITEM_MS)
            const dur = clamp(dur0 - (mediaIn - in0), MIN_ITEM_MS, Math.max(videoMs - mediaIn, MIN_ITEM_MS))
            updateClip(it.clip.id, { mediaInMs: mediaIn, durationMs: dur })
            return `video mulai ${secs(mediaIn)} · ${secs(dur)}`
          }
          const dur = clamp(dur0 - Math.round(d * 1000), MIN_ITEM_MS, MAX_IMAGE_MS)
          updateClip(it.clip.id, { durationMs: dur })
          return secs(dur)
        }
      }
    }
  })

  // ---- voices: trim either edge, or move inside the clip ----
  const voiceSpec = (it: TimelineItem): DragSpec => ({
    click: () => pick({ kind: 'voice', id: it.clip.id }, it.start),
    begin: (mode) => {
      if (!it.audio) return null
      const audioMs = it.audio.durationMs ?? UNKNOWN_AUDIO_MS
      const in0 = it.clip.voiceInMs ?? 0
      const out0 = it.clip.voiceOutMs ?? audioMs
      const start0 = it.clip.voiceStartMs ?? 0
      return {
        move: (d) => {
          const dms = Math.round(d * 1000)
          if (mode === 'move') {
            const start = clamp(Math.round((snap(it.start + (start0 + dms) / 1000) - it.start) * 1000), 0, it.clip.durationMs - MIN_ITEM_MS)
            updateClip(it.clip.id, { voiceStartMs: start })
            return `mulai ${secs(start)} di klip`
          }
          if (mode === 'left') {
            const dd = clamp(dms, Math.max(-in0, -start0), out0 - MIN_ITEM_MS - in0)
            updateClip(it.clip.id, { voiceInMs: in0 + dd, voiceStartMs: start0 + dd })
            return secs(out0 - in0 - dd)
          }
          const endT = snap(it.start + (start0 + out0 - in0 + dms) / 1000)
          const out = clamp(Math.round(in0 + (endT - it.start) * 1000 - start0), in0 + MIN_ITEM_MS, audioMs)
          updateClip(it.clip.id, { voiceOutMs: out >= audioMs ? null : out })
          return secs(out - in0)
        }
      }
    }
  })

  // ---- captions: move or stretch a chunk; its words are re-timed when the drag ends ----
  const captionSpec = (c: CaptionChunk, i: number): DragSpec => ({
    click: () => c.source && pick({ kind: 'caption', chunk: c }, c.start + 0.01),
    begin: (mode) => {
      const src = c.source
      const item = src && items.find((it) => it.audio?.id === src.key)
      const win = item && voiceWindow(item)
      if (!src || !win) return null
      const prev = chunks[i - 1]?.source?.key === src.key ? chunks[i - 1] : null
      const next = chunks[i + 1]?.source?.key === src.key ? chunks[i + 1] : null
      const lo = prev ? prev.end : win.from
      const hi = next ? next.start : win.to
      let start = c.start
      let end = c.end
      return {
        move: (d) => {
          if (mode === 'move') {
            const len = c.end - c.start
            start = clamp(snap(c.start + d), lo, Math.max(lo, hi - len))
            end = start + len
          } else if (mode === 'left') start = clamp(snap(c.start + d), lo, c.end - 0.15)
          else end = clamp(snap(c.end + d), c.start + 0.15, hi)
          setCapDrag({ key: src.key, from: src.from, start, end })
          return `${timecode(start)} – ${timecode(end)}`
        },
        end: () => {
          setCapDrag(null)
          const asset = assets[src.key]
          if (!asset || (start === c.start && end === c.end)) return
          useProject.getState().editWords(asset.id, retimedWords(asset.meta.words ?? [], c, start, end)).catch((e) => toast('error', errorText(e)))
        }
      }
    }
  })

  // ---- music: trim either edge (the song keeps its place), or move it ----
  const musicSpec: DragSpec = {
    click: () => pick({ kind: 'music' }),
    begin: (mode) => {
      const m0 = musicSpan(editor, total)
      const len = m0.endSec - m0.startSec
      const toMs = (s: number): number => Math.round(s * 1000)
      return {
        move: (d) => {
          if (mode === 'move') {
            const s = clamp(snap(m0.startSec + d), 0, Math.max(0, total - len))
            updateEditor({ musicStartMs: toMs(s), musicEndMs: s + len >= total - 0.01 ? null : toMs(s + len) })
            return `${timecode(s)} – ${timecode(s + len)}`
          }
          if (mode === 'left') {
            const s = clamp(snap(m0.startSec + d), Math.max(0, m0.startSec - m0.inSec), m0.endSec - 0.5)
            updateEditor({ musicStartMs: toMs(s), musicInMs: toMs(m0.inSec + (s - m0.startSec)) })
            return `mulai ${timecode(s)}`
          }
          const e = clamp(snap(m0.endSec + d), m0.startSec + 0.5, total)
          updateEditor({ musicEndMs: e >= total - 0.01 ? null : toMs(e) })
          return `selesai ${timecode(e)}`
        }
      }
    }
  }

  // ---- overlays: trim either edge, or move ----
  const overlaySpec = (o: Overlay, start: number, end: number): DragSpec => ({
    click: () => pick({ kind: 'overlay', id: o.id }, start + 0.01),
    begin: (mode) => {
      const len = end - start
      return {
        move: (d) => {
          if (mode === 'move') {
            const s = r2(clamp(snap(start + d), 0, Math.max(0, total - len)))
            updateOverlay(o.id, { start: s, end: s + len >= total - 0.01 ? null : r2(s + len) })
            return `${timecode(s)} – ${timecode(s + len)}`
          }
          if (mode === 'left') {
            const s = r2(clamp(snap(start + d), 0, end - MIN_ITEM_MS / 1000))
            updateOverlay(o.id, { start: s })
            return `mulai ${timecode(s)}`
          }
          const e = r2(clamp(snap(end + d), start + MIN_ITEM_MS / 1000, total))
          updateOverlay(o.id, { end: e >= total - 0.01 ? null : e })
          return `selesai ${timecode(e)}`
        }
      }
    }
  })

  const btn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-2 bg-surface px-2.5 text-[13px] font-medium text-ink hover:border-ink-2 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-t border-line-2 bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-[13px] text-ink-2">
        <button type="button" className={btn} disabled={!canSplit} onClick={onSplit} title="Potong di posisi playhead (S)">
          <Scissors className="size-4" />
          Potong
        </button>
        <button type="button" className={btn} disabled={!canDelete} onClick={onDelete} title="Hapus item yang dipilih (Delete)">
          <Trash2 className="size-4" />
          Hapus
        </button>
        <button type="button" className={btn} disabled={!canUndo} onClick={undo} title="Batalkan aksi terakhir (Ctrl+Z)">
          <Undo2 className="size-4" />
          Undo
        </button>
        <button type="button" className={btn} disabled={!canRedo} onClick={redo} title="Ulangi aksi (Ctrl+Y / Ctrl+Shift+Z)">
          <Redo2 className="size-4" />
          Redo
        </button>
        <span className="ml-2 min-w-0 truncate">Klik untuk memilih, tarik tepinya untuk mengubah durasi, geser untuk memindahkan.</span>
        <span className="flex-1" />
        <label className="flex shrink-0 items-center gap-2">
          <ZoomIn className="size-4" />
          Zoom
          <input type="range" min={1} max={8} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom timeline" className="w-32" />
        </label>
      </div>
      <div
        ref={scroller}
        className="scroll-thin relative min-h-0 flex-1 overflow-auto pt-1.5"
        style={{ scrollbarGutter: 'stable' }}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onPointerDown={(e) => {
          if (e.clientX - e.currentTarget.getBoundingClientRect().left < LABEL_W) return
          e.currentTarget.setPointerCapture(e.pointerId)
          seekFrom(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId) && seekFrom(e)}
      >
        <div className="relative" style={{ width: Math.max(
          ORIGIN + total * pps + 16,
          ...(editor.sfx ?? []).map((s) => ORIGIN + s.startMs / 1000 * pps + Math.max(36, s.durationMs / 1000 * pps)),
          ...(editor.overlays ?? []).map((o) => ORIGIN + (o.end ?? total) * pps),
          ...items.map((it) => ORIGIN + it.end * pps)
        ) }}>
          <Row label="" height={22}>
            {ticks.map((s) => (
              <span key={s} className="absolute top-0 h-[21px] border-l border-line-2 pl-1 font-mono text-[11px] text-muted" style={{ left: s * pps }}>
                {Math.floor(s / 60)}:{String(Math.round(s % 60)).padStart(2, '0')}
              </span>
            ))}
          </Row>

          <Row label="Klip" icon={<ImageIcon className="size-4" />} height={64} trackId="clips">
            {visibleItems.map((it) => {
              const spec = clipSpec(it)
              const videoLeft = it.clip.motionType === 'video' && it.video?.durationMs ? it.video.durationMs - (it.clip.mediaInMs ?? 0) : null
              const held = videoLeft != null && it.clip.durationMs > videoLeft + 50 ? (it.clip.durationMs - videoLeft) / 1000 : 0
              return (
                <div
                  key={it.clip.id}
                  role="button"
                  tabIndex={0}
                  {...on(spec, 'move')}
                  onKeyDown={(e) => e.key === 'Enter' && !e.currentTarget.closest('[data-track-locked="true"]') && spec.click()}
                  aria-label={`Klip ${it.index + 1} ${it.clip.title}`}
                  aria-pressed={is('clip', it.clip.id)}
                  className={cx(
                    'absolute top-0 flex h-16 cursor-pointer select-none flex-col justify-between overflow-hidden rounded-lg border border-ink bg-sand bg-cover bg-center p-1.5 text-left',
                    is('clip', it.clip.id) && SELECTED
                  )}
                  style={{
                    left: it.start * pps + 1,
                    width: Math.max(8, (it.end - it.start) * pps - 3),
                    backgroundImage: it.image ? `url("${it.image.url}")` : undefined
                  }}
                >
                  <span className="pointer-events-none flex items-center gap-1 self-start">
                    <span className="rounded-[5px] border border-ink bg-surface px-1 font-mono text-[11px]">{String(it.index + 1).padStart(2, '0')}</span>
                    {it.clip.motionType === 'video' && it.video && (
                      <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-ink text-paper" title="Video AI">
                        <Film className="size-3" />
                      </span>
                    )}
                    {it.audio && (
                      <span
                        className={cx(
                          'rounded-[4px] px-1 font-mono text-[9px] font-bold shadow-sm',
                          it.audio.meta.words?.length && !it.audio.meta.estimatedTimings
                            ? 'border border-ok-soft bg-ok-soft text-ok-ink'
                            : 'border border-sun-soft bg-sun-soft text-sun-ink'
                        )}
                        title={it.audio.meta.words?.length && !it.audio.meta.estimatedTimings ? 'Caption sinkron (Whisper)' : 'Caption estimasi'}
                      >
                        {it.audio.meta.words?.length && !it.audio.meta.estimatedTimings ? 'SYNC' : 'EST'}
                      </span>
                    )}
                  </span>
                  <div className="pointer-events-none flex w-full items-end justify-between gap-1">
                    <span className="max-w-[70%] truncate rounded bg-surface/85 px-1 text-xs font-semibold">{it.clip.title}</span>
                    <span className="rounded bg-ink/75 px-1 font-mono text-[10px] text-paper">{secs(it.clip.durationMs)}</span>
                  </div>
                  {held > 0 && (
                    <span
                      title="Videonya sudah habis di sini; frame terakhirnya ditahan"
                      className="pointer-events-none absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,rgba(31,29,26,0.35)_0_4px,transparent_4px_8px)]"
                      style={{ width: held * pps }}
                    />
                  )}
                  {edges(spec, 'klip', is('clip', it.clip.id))}
                </div>
              )
            })}
            {/* One button on each joint: the transition belongs to the clip before it. */}
            {visibleTransitions.map(({ it, before }) => (
              <TransitionButton
                key={`tr-${before.clip.id}`}
                clip={before.clip}
                next={it.clip}
                x={it.start * pps}
                selected={is('transition', before.clip.id)}
                onPick={() => pick({ kind: 'transition', id: before.clip.id })}
              />
            ))}
          </Row>

          <Row
            label="Caption"
            icon={<Type className="size-4" />}
            height={30}
            trackId="captions"
            onDragOver={(e) => {
              if ([...e.dataTransfer.types].includes('Files')) e.preventDefault()
            }}
            onDrop={(e) => void dropSfx(e)}
            action={
              <button
                type="button"
                aria-label={captionsHidden ? 'Tampilkan caption' : 'Sembunyikan caption'}
                title={captionsHidden ? 'Tampilkan caption' : 'Sembunyikan caption'}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleCaptionsHide()
                }}
                className={cx(
                  'flex size-5 items-center justify-center rounded transition-colors',
                  captionsHidden ? 'text-accent hover:bg-sun-soft' : 'text-muted hover:text-ink'
                )}
              >
                {captionsHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            }
          >
            {visibleChunks.map((c) => {
              const i = chunks.indexOf(c)
              const selected = !!c.source && selection?.kind === 'caption' && selection.key === c.source.key && selection.from === c.source.from
              const live = capDrag && c.source && capDrag.key === c.source.key && capDrag.from === c.source.from ? capDrag : null
              const start = live ? live.start : c.start
              const end = live ? live.end : c.end
              const text = c.words.map((w) => w.text).join(' ')
              const spec = captionSpec(c, i)
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  {...on(spec, 'move')}
                  onKeyDown={(e) => e.key === 'Enter' && !e.currentTarget.closest('[data-track-locked="true"]') && spec.click()}
                  title={`${text} (klik untuk edit teks)`}
                  aria-pressed={selected}
                  className={cx(
                    'absolute top-0 flex h-[30px] cursor-pointer select-none items-center overflow-hidden whitespace-nowrap rounded-md border border-sun-soft bg-sun-soft px-1.5 text-xs text-sun-ink hover:border-sun-ink',
                    selected && SELECTED
                  )}
                  style={{ left: start * pps + 1, width: Math.max(4, (end - start) * pps - 2) }}
                >
                  <span className="pointer-events-none truncate">{text}</span>
                  {edges(spec, 'caption', selected)}
                </div>
              )
            })}
          </Row>

          <Row
            label="Suara TTS"
            icon={<Mic className="size-4" />}
            height={40}
            trackId="voice"
            action={
              <button
                type="button"
                aria-label={voiceMuted ? 'Bunyikan suara' : 'Bisukan suara'}
                title={voiceMuted ? 'Bunyikan suara' : 'Bisukan suara'}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleVoiceMute()
                }}
                className={cx(
                  'flex size-5 items-center justify-center rounded transition-colors',
                  voiceMuted ? 'text-accent hover:bg-sun-soft' : 'text-muted hover:text-ink'
                )}
              >
                {voiceMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
              </button>
            }
          >
            {visibleItems.map((it) => {
              if (!it.audio) return null
              const span = voiceSpan(it.clip, it.audio.durationMs ?? UNKNOWN_AUDIO_MS)
              if (span.playMs <= 0) return null
              const spec = voiceSpec(it)
              const cut = span.lengthMs > span.playMs + 30
              return (
                <div
                  key={`${it.clip.id}-${it.audio.id}`}
                  role="button"
                  tabIndex={0}
                  {...on(spec, 'move')}
                  onKeyDown={(e) => e.key === 'Enter' && !e.currentTarget.closest('[data-track-locked="true"]') && spec.click()}
                  aria-label={`Suara klip ${it.index + 1}`}
                  aria-pressed={is('voice', it.clip.id)}
                  className={cx(
                    'absolute top-0 flex h-10 cursor-pointer select-none items-center overflow-hidden rounded-md border border-line-2 bg-draft px-1 hover:border-ink-2',
                    is('voice', it.clip.id) && SELECTED
                  )}
                  style={{ left: (it.start + span.startMs / 1000) * pps + 1, width: Math.max(4, (span.playMs / 1000) * pps - 2) }}
                >
                  <Waveform url={it.audio.url} className="pointer-events-none h-8 w-full" />
                  {cut && (
                    <span
                      title="Suaranya terpotong di akhir klip. Panjangkan klip, atau potong suaranya."
                      className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-bad-ink"
                    />
                  )}
                  {edges(spec, 'suara', is('voice', it.clip.id))}
                </div>
              )
            })}
          </Row>

          <Row
            label="Musik"
            icon={<Music className="size-4" />}
            height={30}
            trackId="music"
            action={
              <button
                type="button"
                aria-label={musicMuted ? 'Bunyikan musik' : 'Bisukan musik'}
                title={musicMuted ? 'Bunyikan musik' : 'Bisukan musik'}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleMusicMute()
                }}
                className={cx(
                  'flex size-5 items-center justify-center rounded transition-colors',
                  musicMuted ? 'text-accent hover:bg-sun-soft' : 'text-muted hover:text-ink'
                )}
              >
                {musicMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
              </button>
            }
          >
            {music && (
              <div
                role="button"
                tabIndex={0}
                {...on(musicSpec, 'move')}
                onKeyDown={(e) => e.key === 'Enter' && !e.currentTarget.closest('[data-track-locked="true"]') && musicSpec.click()}
                aria-pressed={is('music')}
                aria-label="Musik latar"
                className={cx(
                  'absolute top-0 flex h-[30px] cursor-pointer select-none items-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-ok-soft bg-ok-soft px-2.5 text-xs text-ok-ink hover:border-ok-ink',
                  is('music') && SELECTED
                )}
                style={{ left: ms.startSec * pps + 1, width: Math.max(10, (ms.endSec - ms.startSec) * pps - 2) }}
              >
                <Music className="pointer-events-none size-3.5 shrink-0" />
                <span className="pointer-events-none truncate">{music.prompt ?? 'Musik latar'}</span>
                {edges(musicSpec, 'musik', is('music'))}
              </div>
            )}
          </Row>

          <Row
            label="Efek Suara"
            icon={<AudioLines className="size-4" />}
            height={30}
            trackId="sfx"
            action={
              <div className="relative flex items-center gap-1">
                <button
                  type="button"
                  aria-label={sfxMuted ? 'Bunyikan efek suara' : 'Bisukan efek suara'}
                  title={sfxMuted ? 'Bunyikan efek suara' : 'Bisukan efek suara'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSfxMute()
                  }}
                  className={cx(
                    'flex size-5 items-center justify-center rounded transition-colors',
                    sfxMuted ? 'text-accent hover:bg-sun-soft' : 'text-muted hover:text-ink'
                  )}
                >
                  {sfxMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>
                <button
                  type="button"
                  aria-label="Tambah efek suara"
                  title="Tambah efek suara pada playhead"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowSfxMenu((prev) => !prev)
                  }}
                  className="flex size-5 items-center justify-center rounded text-muted hover:bg-sand-2 hover:text-ink transition-colors"
                >
                  <Plus className="size-3.5" />
                </button>
                {showSfxMenu && (
                  <div
                    className="absolute left-0 top-6 z-50 w-56 rounded-lg border border-line bg-paper p-1.5 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={addAutoSfx}
                      title="Pasang efek suara sesuai kata di narasi dan transisi"
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold text-accent-dark hover:bg-accent/10"
                    >
                      <Sparkles className="size-3.5" />
                      <span>SFX Otomatis</span>
                    </button>
                    <div className="my-1 border-t border-line" />
                    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Pustaka SFX Bawaan
                    </div>
                    {BUILTIN_SFX.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => addBuiltinSfx(s.id)}
                        className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-ink hover:bg-sand-2"
                      >
                        <span className="font-medium">{s.name}</span>
                        <span className="text-[10px] text-muted">{(s.durationMs / 1000).toFixed(1)}s</span>
                      </button>
                    ))}
                    <div className="my-1 border-t border-line" />
                    <button
                      type="button"
                      onClick={addCustomSfx}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold text-accent-dark hover:bg-accent/10"
                    >
                      <Plus className="size-3.5" />
                      <span>Unggah File Sendiri...</span>
                    </button>
                  </div>
                )}
              </div>
            }
          >
            {visibleSfx.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onPointerDown={(e) => startSfxDrag(e, s)}
                onClick={(e) => { if (!e.currentTarget.closest('[data-track-locked="true"]')) onPick({ kind: 'sfx', id: s.id }) }}
                className={cx('group absolute top-0 flex h-[30px] cursor-grab select-none items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border bg-sun-soft px-2 text-xs text-sun-ink shadow-xs hover:border-sun-ink active:cursor-grabbing', is('sfx', s.id) ? SELECTED : 'border-line-2')}
                style={{
                  left: (s.startMs / 1000) * pps + 1,
                  width: Math.max(36, (s.durationMs / 1000) * pps - 2)
                }}
                title={`${s.name} (${(s.durationMs / 1000).toFixed(1)}s) - Geser untuk memindahkan`}
              >
                <span aria-hidden className="absolute inset-y-0 left-0 z-[2] w-2 cursor-ew-resize bg-transparent hover:bg-ink/20" onPointerDown={(e) => startSfxDrag(e, s, 'left')} />
                <AudioLines className="pointer-events-none size-3.5 shrink-0 text-sun-ink" />
                <span className="pointer-events-none truncate font-medium">{s.name}</span>
                <span aria-hidden className="absolute inset-y-0 right-0 z-[2] w-2 cursor-ew-resize bg-transparent hover:bg-ink/20" onPointerDown={(e) => startSfxDrag(e, s, 'right')} />
                <button
                  type="button"
                  aria-label="Hapus SFX"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeSfx(s.id)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="ml-auto rounded p-0.5 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </Row>

          {(lanes.length ? lanes : [[]]).map((lane, li) => (
            <Row
              key={li}
              label={li === 0 ? 'Overlay' : `Overlay ${li + 1}`}
              icon={<Layers className="size-4" />}
              height={30}
              trackId="overlays"
              action={
                li === 0 ? (
                  <button
                    type="button"
                    aria-label={overlaysHidden ? 'Tampilkan overlay' : 'Sembunyikan overlay'}
                    title={overlaysHidden ? 'Tampilkan overlay' : 'Sembunyikan overlay'}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleOverlaysHide()
                    }}
                    className={cx(
                      'flex size-5 items-center justify-center rounded transition-colors',
                      overlaysHidden ? 'text-accent hover:bg-sun-soft' : 'text-muted hover:text-ink'
                    )}
                  >
                    {overlaysHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                ) : undefined
              }
            >
              {lane.filter(({ start, end }) => end >= visibleFrom && start <= visibleTo).map(({ o, start, end }) => {
                const label = o.kind === 'text' ? o.text.split('\n')[0] || 'Teks' : (assets[o.assetId]?.prompt ?? 'Gambar')
                const spec = overlaySpec(o, start, end)
                return (
                  <div
                    key={o.id}
                    role="button"
                    tabIndex={0}
                    {...on(spec, 'move')}
                    onKeyDown={(e) => e.key === 'Enter' && !e.currentTarget.closest('[data-track-locked="true"]') && spec.click()}
                    aria-pressed={is('overlay', o.id)}
                    title={label}
                    className={cx(
                      'absolute top-0 flex h-[30px] cursor-pointer select-none items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border px-2 text-xs font-medium',
                      o.kind === 'image' ? 'border-[#A9C3E3] bg-info-soft text-info-ink' : 'border-[#CFC3EA] bg-[#EFEAFA] text-[#4A3B78]',
                      is('overlay', o.id) && SELECTED
                    )}
                    style={{ left: start * pps + 1, width: Math.max(10, (end - start) * pps - 2) }}
                  >
                    {o.kind === 'image' ? <ImageIcon className="pointer-events-none size-3.5 shrink-0" /> : <Type className="pointer-events-none size-3.5 shrink-0" />}
                    <span className="pointer-events-none truncate">{label}</span>
                    {edges(spec, 'overlay', is('overlay', o.id))}
                  </div>
                )
              })}
            </Row>
          ))}

          <Playhead pps={pps} />
        </div>
      </div>
      {badge && (
        <span
          className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-md bg-ink px-2 py-1 font-mono text-[11px] text-paper shadow-lg"
          style={{ left: badge.x, top: badge.y - 34 }}
        >
          {badge.text}
        </span>
      )}
    </section>
  )
}
