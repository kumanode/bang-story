import { useEffect, useState } from 'react'
import { AudioLines, Captions, Cpu, Download, FileUp, FolderOpen, Trash2, Unlink } from 'lucide-react'
import type { AppSettings, WhisperStatus } from '@shared/types'
import { Badge, Button, Progress, Switch, confirmDialog } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'

const mb = (n: number): string => `${Math.round(n / 1_000_000).toLocaleString('id-ID')} MB`

/** Settings for the local Whisper model (built-in download or user-selected GGML `.bin`) that times caption words. */
export function WhisperSection({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const { toast } = useApp()
  const [status, setStatus] = useState<WhisperStatus | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.whisper.status().then(setStatus)
    return window.api.on.whisper((next) => {
      setStatus(next)
      setPickError(null)
    })
  }, [])

  if (!status) return null
  const busy = status.state === 'downloading' || status.state === 'verifying'
  const isCustom = status.source === 'custom'

  const pickModel = async (): Promise<void> => {
    setPickError(null)
    try {
      const next = await window.api.whisper.pickModel()
      if (next) {
        setStatus(next)
        toast('success', `Model Whisper siap dipakai: ${next.modelName ?? 'file lokal'}`)
      }
    } catch (e) {
      setPickError(errorText(e))
    }
  }

  const clearCustom = async (): Promise<void> => {
    setPickError(null)
    const next = await window.api.whisper.clearCustomModel()
    setStatus(next)
    toast('info', 'Tautan model manual dilepas. File aslimu tetap aman.')
  }

  const pickCli = async (): Promise<void> => {
    setPickError(null)
    try {
      const next = await window.api.whisper.pickCli()
      if (next) {
        setStatus(next)
        toast('success', 'Biner whisper-cli kustom berhasil dipasang.')
      }
    } catch (e) {
      setPickError(errorText(e))
    }
  }

  const clearCli = async (): Promise<void> => {
    setPickError(null)
    const next = await window.api.whisper.clearCustomCli()
    setStatus(next)
    toast('info', 'Kembali memakai whisper-cli bawaan (CPU).')
  }

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Hapus model Whisper?',
      body: `File model (${mb(status.total)}) dihapus dari komputer ini. Caption yang sudah disinkronkan tetap aman, dan model bisa diunduh lagi kapan saja.`,
      confirm: 'Hapus model',
      danger: true
    })
    if (ok) await window.api.whisper.remove()
  }

  const shownError = pickError ?? (!busy ? status.error : null)

  return (
    <>
      <div className="mt-5 flex items-start gap-3">
        <span className="mt-1 text-ink">
          <Captions className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[22px] font-bold leading-tight">Caption akurat</h2>
          <p className="text-sm text-ink-2">Menyamakan waktu tiap kata caption dengan suara narasi, langsung di komputer ini.</p>
        </div>
      </div>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-ink bg-ink text-paper">
            <AudioLines className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-bold">
              {isCustom && status.modelName ? `Whisper · ${status.modelName}` : 'Whisper Small'}
            </span>
            <span className="text-[13px] text-ink-2">
              {isCustom && status.state === 'ready'
                ? `Model manual (whisper.cpp GGML) · ${mb(status.total)}`
                : `Pengenal suara multibahasa (termasuk Indonesia) lewat whisper.cpp · ${mb(status.total)}`}
            </span>
          </div>
          {status.state === 'ready' ? (
            <Badge tone="ok">Siap dipakai</Badge>
          ) : busy ? (
            <Badge tone="warn">{status.state === 'verifying' ? 'Memeriksa file' : 'Mengunduh'}</Badge>
          ) : (
            <Badge tone="draft">Belum siap</Badge>
          )}
        </div>

        <p className="text-[13px] leading-relaxed text-ink-2">
          Dipakai untuk suara Gemini TTS, yang tidak mengirim waktu per kata. Suara ElevenLabs sudah membawa waktu kata yang presisi. Kamu bisa mengunduh
          model bawaan atau langsung memilih file model whisper.cpp (<code className="font-mono text-xs">.bin</code>) yang sudah ada di komputermu tanpa
          mengunduh ulang.
        </p>

        {isCustom && status.modelPath && (
          <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-sand px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Lokasi file model</span>
            <span className="break-all font-mono text-xs text-ink-2">{status.modelPath}</span>
          </div>
        )}

        {busy && (
          <div className="flex flex-col gap-1.5">
            <Progress value={status.total ? status.received / status.total : 0} />
            <span className="font-mono text-xs text-ink-2">
              {mb(status.received)} dari {mb(status.total)}
              {status.state === 'verifying' ? ' · memeriksa keutuhan file…' : ''}
            </span>
          </div>
        )}
        {shownError && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">{shownError}</p>}

        <div className="flex flex-wrap gap-2">
          {status.state === 'ready' && isCustom ? (
            <>
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void window.api.whisper.openFolder()}>
                Buka folder
              </Button>
              <Button icon={<FileUp className="size-4" />} onClick={() => void pickModel()}>
                Ganti file (.bin)
              </Button>
              <Button variant="ghost" icon={<Unlink className="size-4" />} onClick={() => void clearCustom()}>
                Lepas model
              </Button>
            </>
          ) : status.state === 'ready' ? (
            <>
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void window.api.whisper.openFolder()}>
                Buka folder
              </Button>
              <Button icon={<FileUp className="size-4" />} onClick={() => void pickModel()}>
                Pakai file lain (.bin)
              </Button>
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
                Hapus model
              </Button>
            </>
          ) : busy ? (
            <Button disabled={status.state === 'verifying'} onClick={() => void window.api.whisper.cancel()}>
              Batal
            </Button>
          ) : (
            <>
              <Button variant="accent" icon={<Download className="size-4" />} onClick={() => void window.api.whisper.download()}>
                {status.received > 0 ? `Lanjutkan unduhan (${mb(status.total - status.received)} lagi)` : `Unduh model (${mb(status.total)})`}
              </Button>
              <Button icon={<FileUp className="size-4" />} onClick={() => void pickModel()}>
                Pilih file model (.bin)
              </Button>
              {isCustom && (
                <Button variant="ghost" icon={<Unlink className="size-4" />} onClick={() => void clearCustom()}>
                  Lepas file
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-dashed border-line pt-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Mesin whisper-cli (opsional GPU)</p>
              <p className="text-[13px] text-muted">
                {status.cliSource === 'custom'
                  ? 'Memakai biner whisper-cli pilihanmu.'
                  : 'Bawaan memakai CPU. Kamu bisa memilih whisper-cli.exe versi CUDA/Vulkan untuk proses lebih cepat.'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" icon={<Cpu className="size-3.5" />} onClick={() => void pickCli()}>
                {status.cliSource === 'custom' ? 'Ganti biner' : 'Pilih whisper-cli'}
              </Button>
              {status.cliSource === 'custom' && (
                <Button size="sm" variant="ghost" onClick={() => void clearCli()}>
                  Pakai bawaan
                </Button>
              )}
            </div>
          </div>
          {status.cliSource === 'custom' && status.cliPath && (
            <span className="break-all rounded-lg border border-line bg-sand px-3 py-1.5 font-mono text-xs text-ink-2">{status.cliPath}</span>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-dashed border-line pt-4">
          <div className="flex-1">
            <p className="text-sm font-semibold">Sinkronkan otomatis</p>
            <p className="text-[13px] text-muted">Setiap kali suara narasi Gemini dibuat, caption langsung disamakan dengan suaranya.</p>
          </div>
          <Switch on={settings.whisperAuto} onChange={async (v) => onSettings(await window.api.settings.set({ whisperAuto: v }))} label="Sinkronkan caption otomatis" />
        </div>
      </section>
    </>
  )
}
