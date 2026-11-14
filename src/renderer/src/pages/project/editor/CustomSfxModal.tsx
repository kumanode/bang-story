import { useState, useRef, useEffect } from 'react'
import { AudioLines, Play, Square, Plus, Sparkles } from 'lucide-react'
import type { Asset } from '@shared/types'
import { Button, Modal, cx, inputCls } from '../../../components/ui'
import { useApp } from '../../../store/app'
import { errorText } from '../../../lib/format'

interface CustomSfxModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  onAdd: (asset: Asset) => void
}

export function CustomSfxModal({ open, onClose, projectId, onAdd }: CustomSfxModalProps) {
  const { toast } = useApp()
  const [prompt, setPrompt] = useState('')
  const [durationSec, setDurationSec] = useState<number>(2.5)
  const [generating, setGenerating] = useState(false)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!open) {
      setPrompt('')
      setDurationSec(2.5)
      setGenerating(false)
      setAsset(null)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlaying(false)
    }
  }, [open])

  const togglePlay = () => {
    if (!asset) return
    if (!audioRef.current) {
      audioRef.current = new Audio(asset.url)
      audioRef.current.onended = () => setPlaying(false)
    }
    if (playing) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setPlaying(false)
    } else {
      audioRef.current.play().catch(() => setPlaying(false))
      setPlaying(true)
    }
  }

  const generate = async () => {
    if (!prompt.trim()) {
      toast('info', 'Ketik deskripsi efek suara terlebih dahulu.')
      return
    }
    setGenerating(true)
    if (audioRef.current) {
      audioRef.current.pause()
      setPlaying(false)
    }
    try {
      const res = await window.api.assets.generateSfx(projectId, {
        prompt: prompt.trim(),
        durationSec,
        name: prompt.trim().slice(0, 30)
      })
      setAsset(res)
      toast('info', 'Efek suara berhasil dibuat!')
      // Langsung preview otomatis
      const a = new Audio(res.url)
      audioRef.current = a
      a.onended = () => setPlaying(false)
      a.play().catch(() => {})
      setPlaying(true)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setGenerating(false)
    }
  }

  const handleCommit = () => {
    if (!asset) return
    onAdd(asset)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buat SFX Kustom (ElevenLabs)"
      subtitle="Ketik deskripsi efek suara apa pun dalam bahasa Inggris untuk di-generate secara orisinal oleh AI."
      width={560}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-2">
            Deskripsi Efek Suara (Prompt)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Contoh: Heavy wooden door slamming shut with long creepy echo in empty corridor"
            rows={3}
            className={cx(inputCls, 'w-full resize-none py-2 text-sm leading-relaxed')}
          />
          <p className="mt-1 text-[11px] text-muted">
            Tip: Gunakan bahasa Inggris deskriptif, sebutkan bahan (wood, metal, glass), aksi, dan ruangan/reverb jika perlu.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-semibold text-ink-2">
              Durasi Suara: <span className="font-mono text-ink">{durationSec.toFixed(1)}s</span>
            </label>
            <span className="text-[11px] text-muted">0.5s - 10s</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={durationSec}
            onChange={(e) => setDurationSec(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
        </div>

        {asset && (
          <div className="flex items-center justify-between rounded-xl border border-line-2 bg-paper p-3 shadow-xs">
            <div className="flex items-center gap-2.5 truncate">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ok-soft text-ok-ink">
                <AudioLines className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">{asset.prompt}</p>
                <p className="text-[11px] text-muted">
                  {((asset.durationMs ?? 0) / 1000).toFixed(1)} detik · Siap dipasang
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={togglePlay}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink hover:bg-surface"
            >
              {playing ? <Square className="size-3.5 fill-current text-accent" /> : <Play className="size-3.5 fill-current" />}
              {playing ? 'Stop' : 'Putar'}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            loading={generating}
            icon={<Sparkles className="size-4" />}
            onClick={() => void generate()}
          >
            {asset ? 'Generate Ulang' : 'Buat & Dengarkan'}
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button
              type="button"
              variant="accent"
              disabled={!asset}
              icon={<Plus className="size-4" />}
              onClick={handleCommit}
            >
              Tambahkan ke Timeline
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
