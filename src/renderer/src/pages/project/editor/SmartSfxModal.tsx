import { useState, useEffect } from 'react'
import { Sparkles, AlertCircle } from 'lucide-react'
import type { Asset, SmartSfxCue } from '@shared/types'
import { Button, Modal, Spinner } from '../../../components/ui'
import { useApp } from '../../../store/app'
import { errorText } from '../../../lib/format'
import type { TimelineItem } from './engine'

interface SmartSfxModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  items: TimelineItem[]
  onBatchAdd: (results: { asset: Asset; startMs: number; volumeDb: number }[]) => void
}

export function SmartSfxModal({ open, onClose, projectId, items, onBatchAdd }: SmartSfxModalProps) {
  const { toast } = useApp()
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [cues, setCues] = useState<SmartSfxCue[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number; name: string } | null>(null)

  useEffect(() => {
    if (!open) {
      setCues([])
      setSelected(new Set())
      setLoadingPlan(false)
      setGenerating(false)
      setProgress(null)
      return
    }

    let active = true
    setLoadingPlan(true)
    window.api.story
      .planSmartSfx(projectId)
      .then((planCues) => {
        if (!active) return
        setCues(planCues)
        setSelected(new Set(planCues.map((_, i) => i)))
      })
      .catch((e) => {
        if (!active) return
        toast('error', `Gagal merancang SFX: ${errorText(e)}`)
      })
      .finally(() => {
        if (active) setLoadingPlan(false)
      })

    return () => {
      active = false
    }
  }, [open, projectId, toast])

  const toggleSelect = (index: number) => {
    const next = new Set(selected)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelected(next)
  }

  const toggleAll = () => {
    if (selected.size === cues.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(cues.map((_, i) => i)))
    }
  }

  const handleGenerate = async () => {
    const indicesToRun = Array.from(selected).sort((a, b) => a - b)
    if (!indicesToRun.length) {
      toast('info', 'Pilih setidaknya satu efek suara untuk di-generate.')
      return
    }

    setGenerating(true)
    const results: { asset: Asset; startMs: number; volumeDb: number }[] = []
    let failedCount = 0

    for (let i = 0; i < indicesToRun.length; i++) {
      const cueIndex = indicesToRun[i]
      const cue = cues[cueIndex]
      setProgress({ current: i + 1, total: indicesToRun.length, name: cue.name })

      try {
        const asset = await window.api.assets.generateSfx(projectId, {
          prompt: cue.prompt,
          durationSec: cue.durationSec,
          name: cue.name
        })

        const item = items.find((it) => it.clip.id === cue.clipId)
        const startSec = item ? item.start + cue.timeOffsetSec : cue.timeOffsetSec
        const startMs = Math.round(startSec * 1000)

        results.push({
          asset,
          startMs,
          volumeDb: cue.volumeDb
        })
      } catch (err) {
        failedCount++
        console.error(`Gagal membuat SFX "${cue.name}":`, err)
      }
    }

    setGenerating(false)
    setProgress(null)

    if (results.length > 0) {
      onBatchAdd(results)
      if (failedCount > 0) {
        toast('info', `${results.length} efek suara terpasang, ${failedCount} efek suara gagal (kuota/koneksi).`)
      } else {
        toast('info', `${results.length} efek suara berhasil dibuat dan dipasang ke timeline.`)
      }
      onClose()
    } else {
      toast('error', 'Semua efek suara gagal di-generate. Periksa kuota atau koneksi ElevenLabs kamu.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={generating ? () => {} : onClose}
      title="AI Auto-SFX Cerita (ElevenLabs)"
      subtitle="AI membaca naskah dan prompt visual untuk menentukan momen dramatis yang membutuhkan efek suara."
      width={680}
    >
      {loadingPlan ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Spinner className="size-8 text-accent mb-3" />
          <p className="text-sm font-semibold text-ink">Menganalisis adegan & merancang cue suara...</p>
          <p className="text-xs text-muted mt-1">Mengidentifikasi momen-momen sinematik terbaik dari naskahmu</p>
        </div>
      ) : cues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <AlertCircle className="size-8 text-muted mb-2" />
          <p className="text-sm font-semibold text-ink">Tidak ada efek suara yang disarankan</p>
          <p className="text-xs text-muted mt-1">Pastikan naskah cerita sudah terisi sebelum menjalankan AI Auto-SFX.</p>
          <div className="mt-5">
            <Button type="button" variant="secondary" onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <span className="text-xs font-semibold text-ink-2">
              Ditemukan {cues.length} momen suara yang disarankan
            </span>
            <button
              type="button"
              onClick={toggleAll}
              disabled={generating}
              className="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
            >
              {selected.size === cues.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
            </button>
          </div>

          <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
            {cues.map((cue, idx) => {
              const isChecked = selected.has(idx)
              const clipIndex = items.findIndex((it) => it.clip.id === cue.clipId) + 1
              return (
                <div
                  key={idx}
                  onClick={() => !generating && toggleSelect(idx)}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    isChecked
                      ? 'border-accent/40 bg-accent-soft/30 shadow-xs'
                      : 'border-line-2 bg-paper hover:border-line-3'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={generating}
                    onChange={() => {}}
                    className="mt-1 size-4 rounded accent-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-ink">{cue.name}</span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted border border-line">
                        Adegan {clipIndex || '?'} (+{cue.timeOffsetSec.toFixed(1)}s)
                      </span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted border border-line">
                        {cue.durationSec.toFixed(1)}s
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-2 line-clamp-2 italic font-mono text-[11px] opacity-90">
                      "{cue.prompt}"
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {progress && (
            <div className="rounded-xl border border-line-2 bg-paper p-3 text-center">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-ink">
                <Spinner className="size-3.5 text-accent" />
                Men-generate ({progress.current}/{progress.total}): {progress.name}
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                Audio langsung disimpan saat selesai. Jangan tutup jendela ini.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
            <p className="text-[11px] text-muted">
              {selected.size} efek suara akan dibuat menggunakan kuota ElevenLabs.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={generating} onClick={onClose}>
                Batal
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={generating || selected.size === 0}
                loading={generating}
                icon={<Sparkles className="size-4" />}
                onClick={() => void handleGenerate()}
              >
                Generate Terpilih ({selected.size})
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
