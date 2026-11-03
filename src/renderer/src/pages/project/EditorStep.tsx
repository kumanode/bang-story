import { useEffect, useRef, useState } from 'react'
import { replaceCaptionWords } from '@shared/captions'
import { overlayEnd } from '@shared/overlays'
import { musicSpan } from '@shared/timeline'
import { frameDuration, frameRateFromStorage } from '@shared/frame'
import { confirmDialog, cx } from '../../components/ui'
import { clipNumber, errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import {
  removeOverlay,
  useAudition,
  useCaptionUi,
  useOverlayUi,
  usePlayback,
  usePlaybackEngine,
  useTrackControls,
  useTimeline,
  type TimelineItem
} from './editor/engine'
import { INSPECTOR_TABS, Inspector, type InspectorTab } from './editor/Inspector'
import { Player } from './editor/Player'
import { Timeline, overlayLanes, type TimelinePick, type TimelineSelection } from './editor/Timeline'

const MIN_TIMELINE_H = 180
const MAX_TIMELINE_RATIO = 0.65

export function EditorStep() {
  const { project, assets, selectedClipId, select, clips, updateClip, updateEditor, removeClip, flush, load } = useProject()
  const { toast } = useApp()
  const { items, total, chunks } = useTimeline()
  const [tab, setTab] = useState<InspectorTab>('klip')
  const [draggingTimeline, setDraggingTimeline] = useState(false)
  /** The clip whose transition into the next clip the Transisi panel shows. */
  const [transitionId, setTransitionId] = useState<string | null>(null)
  const [selectedSfxId, setSelectedSfxId] = useState<string | null>(null)
  const selectedOverlayId = useOverlayUi((s) => s.selectedId)
  const selectOverlay = useOverlayUi((s) => s.select)
  const captionSel = useCaptionUi((s) => s.selected)
  const selectCaption = useCaptionUi((s) => s.select)
  const music = project?.editor.musicAssetId ? (assets[project.editor.musicAssetId] ?? null) : null
  const musicRange = project ? musicSpan(project.editor, total) : undefined
  usePlaybackEngine(
    items,
    total,
    music,
    project?.editor.musicVolumeDb ?? -18,
    project?.editor.duckMusic ?? true,
    project?.editor.voiceVolumeDb ?? 0,
    musicRange,
    project?.editor.sfx,
    assets
  )

  // Keyboard actions use the latest handlers, which are set on every render below.
  const actions = useRef({ split: async (): Promise<void> => {}, remove: async (): Promise<void> => {} })
  const deleting = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      const tag = el?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
      if (typing || document.querySelector('[role="dialog"]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        const s = usePlayback.getState()
        if (!s.playing && s.t >= total - 0.05) s.seek(0)
        s.toggle()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        void actions.current.remove()
      } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        void actions.current.split()
      } else if ((e.key === 'b' || e.key === 'B') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void actions.current.split()
      } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        useProject.getState().undo()
      } else if (
        ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
        ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey))
      ) {
        e.preventDefault()
        useProject.getState().redo()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const s = usePlayback.getState()
        let rate: 30 | 60 = 30
        try { rate = frameRateFromStorage(localStorage.getItem('bangstory_export_fps')) } catch { /* Use the default frame rate. */ }
        s.seek(Math.max(0, Math.min(total, s.t + (e.key === 'ArrowLeft' ? -1 : 1) * frameDuration(rate))))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total])

  // A preview loop ends as soon as the real playback is used: play, or a move of the playhead.
  useEffect(
    () =>
      usePlayback.subscribe((s, p) => {
        if (s.t !== p.t || (s.playing && !p.playing)) useAudition.getState().stop()
      }),
    []
  )
  // ... and when the panel switches to something else. Cleanup runs before the next panel starts its own loop.
  useEffect(() => () => useAudition.getState().stop(), [tab, selectedClipId, transitionId])
  useEffect(() => {
    useTrackControls.getState().reset()
    usePlayback.setState({ t: 0, playing: false })
  }, [project?.id])

  const overlays = project?.editor.overlays ?? []
  /** What "Potong" cuts at the playhead: the selected overlay when the playhead is inside it, else the clip there. */
  const splitTarget = (t: number): { kind: 'overlay'; id: string } | { kind: 'clip'; item: TimelineItem } | null => {
    if (tab === 'overlay' && selectedOverlayId) {
      const o = overlays.find((x) => x.id === selectedOverlayId)
      if (o && t > o.start + 0.1 && t < overlayEnd(o, total) - 0.1) return { kind: 'overlay', id: o.id }
    }
    const item = items.find((it) => t > it.start + 0.3 && t < it.end - 0.3)
    return item ? { kind: 'clip', item } : null
  }
  const canSplit = usePlayback((s) => splitTarget(s.t) !== null)

  // Resizable timeline state persisted in localStorage. These hooks stay above the early return below.
  const maxTimelineHeight = Math.max(MIN_TIMELINE_H, Math.round(window.innerHeight * MAX_TIMELINE_RATIO))
  const clampTimelineHeight = (height: number): number => Math.max(MIN_TIMELINE_H, Math.min(maxTimelineHeight, height))
  const defaultHeight = clampTimelineHeight(360 + (Math.max(1, overlayLanes(overlays, total).length) - 1) * 38)
  const [timelineHeight, setTimelineHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('bangstory_timeline_height')
      if (saved) {
        const val = Number(saved)
        if (Number.isFinite(val)) return clampTimelineHeight(val)
      }
    } catch { /* Storage can be disabled by the browser profile. */ }
    return defaultHeight
  })
  const isResizing = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)
  const latestHeight = useRef(timelineHeight)
  useEffect(() => {
    const resize = (): void => setTimelineHeight((height) => {
      const max = Math.max(MIN_TIMELINE_H, Math.round(window.innerHeight * MAX_TIMELINE_RATIO))
      const next = Math.max(MIN_TIMELINE_H, Math.min(max, height))
      latestHeight.current = next
      return next
    })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [maxTimelineHeight])

  const endTimelineResize = (): void => {
    isResizing.current = false
    setDraggingTimeline(false)
    try { localStorage.setItem('bangstory_timeline_height', String(latestHeight.current)) } catch { /* Storage is optional. */ }
  }

  if (!project) return null
  const selIndex = clips.findIndex((c) => c.id === selectedClipId)
  const sel = selIndex >= 0 ? clips[selIndex] : null

  // The timeline marks whatever the open panel is editing, so only one thing ever looks selected.
  const selection = ((): TimelineSelection => {
    if (tab === 'klip' && selectedClipId) return { kind: 'clip', id: selectedClipId }
    if (tab === 'suara' && selectedClipId) return { kind: 'voice', id: selectedClipId }
    if (tab === 'transisi' && transitionId) return { kind: 'transition', id: transitionId }
    if (tab === 'caption' && captionSel) return { kind: 'caption', key: captionSel.key, from: captionSel.from }
    if (tab === 'musik' && music) return { kind: 'music' }
    if (tab === 'sfx' && selectedSfxId) return { kind: 'sfx', id: selectedSfxId }
    if (tab === 'overlay' && selectedOverlayId) return { kind: 'overlay', id: selectedOverlayId }
    return null
  })()

  const onSplit = async (): Promise<void> => {
    const t = usePlayback.getState().t
    const target = splitTarget(t)
    if (!target) return
    useAudition.getState().stop()
    if (target.kind === 'overlay') {
      useProject.getState().checkpoint()
      const at = Math.round(t * 100) / 100
      const second = crypto.randomUUID()
      updateEditor({
        overlays: overlays.flatMap((o) => (o.id === target.id ? [{ ...o, end: at }, { ...o, id: second, start: at }] : [o]))
      })
      selectOverlay(second)
      return
    }
    try {
      useProject.getState().checkpoint()
      await flush()
      const bundle = await window.api.clips.split(target.item.clip.id, Math.round((t - target.item.start) * 1000))
      load(bundle, { keepHistory: true })
      const i = bundle.clips.findIndex((c) => c.id === target.item.clip.id)
      const next = bundle.clips[i + 1]
      if (next) {
        const framing = bundle.project.editor.clipFraming?.[target.item.clip.id]
        if (framing) useProject.getState().applyEditor({ clipFraming: { ...(bundle.project.editor.clipFraming ?? {}), [next.id]: framing } })
        select(next.id)
        setTab('klip')
      }
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!selection || deleting.current) return
    deleting.current = true
    useAudition.getState().stop()
    try {
      if (selection.kind === 'clip') {
        const i = clips.findIndex((c) => c.id === selection.id)
        if (i < 0) return
        const ok = await confirmDialog({
          title: `Hapus klip ${clipNumber(i)}?`,
          body: `“${clips[i].title}” dihapus dari video, termasuk naskah, gambar, dan suaranya. Klip setelahnya bergeser maju.`,
          confirm: 'Hapus klip'
        })
        if (ok) removeClip(selection.id)
      } else if (selection.kind === 'voice') {
        useProject.getState().checkpoint()
        await flush()
        await window.api.clips.detachVoice(selection.id)
      } else if (selection.kind === 'caption') {
        const chunk = chunks.find((c) => c.source?.key === selection.key && c.source.from === selection.from)
        const asset = assets[selection.key]
        if (chunk?.source && asset) {
          useProject.getState().checkpoint()
          await useProject.getState().editWords(asset.id, replaceCaptionWords(asset.meta.words ?? [], chunk.source.from, chunk.source.count, ''))
          selectCaption(null)
        }
      } else if (selection.kind === 'music') {
        updateEditor({ musicAssetId: null })
      } else if (selection.kind === 'overlay') {
        removeOverlay(selection.id)
      } else if (selection.kind === 'transition') {
        updateClip(selection.id, { transition: 'cut' })
      } else if (selection.kind === 'sfx') {
        const sfx = (project?.editor.sfx ?? []).filter((item) => item.id !== selection.id)
        updateEditor({ sfx })
        setSelectedSfxId(null)
      }
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      deleting.current = false
    }
  }
  actions.current = { split: onSplit, remove: onDelete }

  const onPick = (p: TimelinePick): void => {
    if (p.kind === 'clip' || p.kind === 'voice') {
      select(p.id)
      setTab(p.kind === 'clip' ? 'klip' : 'suara')
    } else if (p.kind === 'caption') {
      if (p.chunk.source) selectCaption({ key: p.chunk.source.key, from: p.chunk.source.from })
      setTab('caption')
    } else if (p.kind === 'music') setTab('musik')
    else if (p.kind === 'sfx') {
      setSelectedSfxId(p.id)
      setTab('sfx')
    }
    else if (p.kind === 'transition') {
      setTransitionId(p.id)
      setTab('transisi')
    } else {
      selectOverlay(p.id)
      setTab('overlay')
    }
  }

  return (
    <div className={`grid h-full grid-cols-[minmax(0,1fr)]${draggingTimeline ? ' select-none' : ''}`} style={{ gridTemplateRows: `minmax(0,1fr) auto ${timelineHeight}px` }}>
      <div className="grid min-h-0 grid-cols-[84px_minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)]">
        <nav aria-label="Panel editor" className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto [&>*]:shrink-0 border-r border-line bg-surface py-3">
          {INSPECTOR_TABS.map((t) => {
            const Icon = t.icon
            const on = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => setTab(t.id)}
                className={cx(
                  'flex h-[62px] w-[68px] flex-col items-center justify-center gap-1 rounded-xl text-xs',
                  on ? 'border-[1.5px] border-ink bg-sun-soft font-semibold text-ink' : 'font-medium text-ink-2 hover:bg-sand'
                )}
              >
                <Icon className="size-5" />
                {t.label}
              </button>
            )
          })}
        </nav>
        <Player
          items={items}
          total={total}
          chunks={chunks}
          aspect={project.aspectRatio}
          editor={project.editor}
          assets={assets}
          editOverlays={tab === 'overlay'}
        />
        <Inspector tab={tab} clip={sel} index={selIndex} total={total} transitionId={transitionId} sfxId={selectedSfxId} />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault()
          isResizing.current = true
          setDraggingTimeline(true)
          startY.current = e.clientY
          startH.current = timelineHeight
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!isResizing.current) return
          const deltaY = startY.current - e.clientY
          const newH = clampTimelineHeight(startH.current + deltaY)
          latestHeight.current = newH
          setTimelineHeight(newH)
        }}
        onPointerUp={(e) => {
          if (!isResizing.current) return
          endTimelineResize()
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {}
        }}
        // Capture can end without a pointerup (window switch, cancelled touch); a drag left open would
        // keep resizing on plain hover and keep text selection off.
        onLostPointerCapture={() => {
          if (isResizing.current) endTimelineResize()
        }}
        onPointerCancel={() => {
          if (isResizing.current) endTimelineResize()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          const next = clampTimelineHeight(timelineHeight + (e.key === 'ArrowUp' ? 20 : -20))
          latestHeight.current = next
          setTimelineHeight(next)
          try { localStorage.setItem('bangstory_timeline_height', String(next)) } catch { /* Storage is optional. */ }
        }}
        aria-valuenow={timelineHeight}
        aria-valuemin={MIN_TIMELINE_H}
        aria-valuemax={maxTimelineHeight}
        className="group relative z-30 -my-1.5 flex h-3 cursor-row-resize items-center justify-center border-t border-line-2 bg-transparent transition-colors hover:bg-accent/20 active:bg-accent/30"
        title="Tarik untuk mengatur tinggi timeline"
      >
        <div className="h-1 w-12 rounded-full bg-line-2 transition-colors group-hover:bg-accent group-active:bg-accent" />
      </div>
      <Timeline
        items={items}
        chunks={project.editor.captionStyle === 'none' ? [] : chunks}
        music={music}
        total={total}
        editor={project.editor}
        assets={assets}
        selection={selection}
        onPick={onPick}
        canSplit={canSplit}
        canDelete={!!selection}
        onSplit={() => void onSplit()}
        onDelete={() => void onDelete()}
      />
    </div>
  )
}
