import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, Download, Film, FolderOpen, ImagePlus, RotateCcw, Sparkles } from 'lucide-react'
import type { ExportOptions, Job, YoutubeMetadata } from '@shared/types'
import { chapterLines, formatChapters } from '@shared/chapters'
import { Button, Modal, Progress, Segmented, Switch, confirmDialog, cx, inputCls } from '../../components/ui'
import { clipNumber, errorText, mmss } from '../../lib/format'
import { useApp } from '../../store/app'
import { isRunning, useProject } from '../../store/project'

const RESOLUTIONS: { id: ExportOptions['resolution']; label: string; sub: string; mb: number }[] = [
  { id: 720, label: '720p', sub: 'Lebih kecil', mb: 0.4 },
  { id: 1080, label: '1080p', sub: 'Disarankan', mb: 0.75 },
  { id: 2160, label: '4K', sub: 'Lebih lama', mb: 2.4 }
]

// Kept for the session, so closing the dialog does not throw away a package that cost an LLM call.
const ytCache = new Map<string, YoutubeMetadata>()

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'video'
  )
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project, clips, assets, jobs, flush } = useProject()
  const { toast } = useApp()
  const [opts, setOpts] = useState<ExportOptions | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [tab, setTab] = useState<'ekspor' | 'youtube'>('ekspor')
  const [ytData, setYtDataState] = useState<YoutubeMetadata | null>(() => (project ? (ytCache.get(project.id) ?? null) : null))
  const setYtData = (data: YoutubeMetadata): void => {
    if (project) ytCache.set(project.id, data)
    setYtDataState(data)
  }
  useEffect(() => setYtDataState(project ? (ytCache.get(project.id) ?? null) : null), [project?.id])
  const [ytLoading, setYtLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [thumbnailBusy, setThumbnailBusy] = useState(false)
  const [nvenc, setNvenc] = useState(false)
  const thumbnails = Object.values(assets).filter((asset) => asset.kind === 'image' && asset.meta.thumbnail === true)

  const chaptersText = useMemo(() => formatChapters(clips), [clips])
  const chapterCount = useMemo(() => chapterLines(clips).length, [clips])

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      toast('info', `${label} berhasil disalin!`)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast('error', 'Gagal menyalin ke clipboard')
    }
  }

  const generateYt = async () => {
    if (!project) return
    setYtLoading(true)
    try {
      await flush()
      const data = await window.api.story.youtubeMetadata(project.id)
      setYtData(data)
      toast('info', 'Kemasan YouTube berhasil dibuat!')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setYtLoading(false)
    }
  }

  const generateThumbnails = async (): Promise<void> => {
    if (!project || !ytData?.thumbnailConcept.prompt) return
    const ok = await confirmDialog({
      title: 'Buat 3 variasi thumbnail?',
      body: 'Tiap variasi adalah satu gambar baru dari layanan gambar yang kamu pakai, jadi kreditnya terpakai tiga kali.',
      confirm: 'Buat 3 gambar'
    })
    if (!ok) return
    setThumbnailBusy(true)
    try {
      await flush()
      await Promise.all([1, 2, 3].map((variation) => window.api.generate.thumbnail(project.id, ytData.thumbnailConcept.prompt, variation)))
      toast('info', 'Tiga variasi thumbnail sedang dibuat. Hasilnya muncul di sini saat selesai.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setThumbnailBusy(false)
    }
  }

  useEffect(() => {
    if (!open || !project) return
    void window.api.exporter.nvencAvailable().then(setNvenc).catch(() => setNvenc(false))
    // A finished or failed export is not shown again; an export still running keeps its progress.
    setJobId((id) => (id && isRunning(useProject.getState().jobs[id]) ? id : null))
    void window.api.exporter.defaultFolder().then((folder) =>
      setOpts({
        fileName: slug(project.title),
        resolution: 1080,
        fps: 30,
        encoder: 'cpu',
        burnCaptions: project.editor.captionStyle !== 'none',
        writeSrt: false,
        normalizeAudio: true,
        duckMusic: project.editor.duckMusic,
        folder
      })
    )
  }, [open])

  if (!project || !opts) return null
  const job: Job | null = jobId ? (jobs[jobId] ?? null) : null
  const running = isRunning(job)
  const totalMs = clips.reduce((n, c) => n + c.durationMs, 0)
  const missing = clips
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !(c.imageAssetId || (c.motionType === 'video' && c.videoAssetId)))
  const noVoice = clips.filter((c) => !c.audioAssetId).length
  const res = RESOLUTIONS.find((r) => r.id === opts.resolution)!
  const sizeMb = Math.round((totalMs / 1000) * res.mb * (opts.fps === 60 ? 1.5 : 1))
  const set = (p: Partial<ExportOptions>): void => {
    setOpts({ ...opts, ...p })
    if (p.fps) {
      try { localStorage.setItem('bangstory_export_fps', String(p.fps)) } catch { /* Storage is optional. */ }
    }
  }

  const start = async (): Promise<void> => {
    try {
      await flush()
      const j = await window.api.exporter.start(project.id, opts)
      useProject.getState().upsertJob(j)
      setJobId(j.id)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const toggles: { key: keyof ExportOptions; title: string; desc: string; disabled?: boolean }[] = [
    {
      key: 'burnCaptions',
      title: 'Tempel caption ke video',
      desc: project.editor.captionStyle === 'none' ? 'Gaya caption diatur ke Tanpa caption' : 'Caption jadi bagian dari gambar',
      disabled: project.editor.captionStyle === 'none'
    },
    { key: 'writeSrt', title: 'Simpan juga file subtitle (.srt)', desc: 'Untuk diunggah terpisah ke YouTube' },
    { key: 'normalizeAudio', title: 'Samakan volume suara', desc: 'Normalisasi ke −14 LUFS, standar YouTube' },
    {
      key: 'duckMusic',
      title: 'Kecilkan musik saat narasi',
      desc: project.editor.musicAssetId ? 'Musik otomatis turun ketika ada suara' : 'Belum ada musik latar',
      disabled: !project.editor.musicAssetId
    }
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ekspor video & Kemasan"
      subtitle={`${project.title} · ${mmss(totalMs)} · ${clips.length} klip · ${project.aspectRatio}`}
      width={680}
    >
      <div className="mb-3">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'ekspor' | 'youtube')}
          options={[
            { id: 'ekspor', label: 'Pengaturan Ekspor' },
            { id: 'youtube', label: 'Kemasan YouTube & Bab (SEO)' }
          ]}
        />
      </div>

      {tab === 'youtube' ? (
        <div className="flex flex-col gap-4 py-1">
          {/* Section: Auto Chapters */}
          <div className="space-y-2 rounded-xl border border-line bg-paper p-3.5">
              <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-ink">Daftar Bab Otomatis (Timestamp)</span>
                <p className="text-xs text-muted">Adegan pendek digabung agar tiap bab berdurasi minimal 10 detik.</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={copied === 'Daftar bab' ? <Check className="size-3.5 text-ok-ink" /> : <Copy className="size-3.5" />}
                onClick={() => void copyToClipboard(chaptersText, 'Daftar bab')}
              >
                {copied === 'Daftar bab' ? 'Tersalin' : 'Salin Bab'}
              </Button>
            </div>
            {chapterCount < 3 && <p className="text-xs text-sun-ink">Video ini menghasilkan {chapterCount} bab. YouTube perlu minimal 3 bab agar daftar bab aktif.</p>}
            <pre className="max-h-36 select-all overflow-y-auto rounded-lg border border-line bg-sand p-2.5 font-mono text-xs leading-relaxed text-ink-2">
              {chaptersText}
            </pre>
          </div>

          {/* Section: AI YouTube Packaging */}
          <div className="space-y-3 rounded-xl border border-line bg-paper p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-ink">Kemasan YouTube AI & SEO</span>
                <p className="text-xs text-muted">Judul pemikat klik, deskripsi SEO lengkap, dan konsep thumbnail.</p>
              </div>
              <Button
                size="sm"
                variant={ytData ? 'secondary' : 'accent'}
                icon={<Sparkles className="size-3.5" />}
                loading={ytLoading}
                onClick={() => void generateYt()}
              >
                {ytData ? 'Buat Ulang' : 'Buat dengan AI'}
              </Button>
            </div>

            {ytData ? (
              <>
              <div className="space-y-3 pt-1">
                {/* 3 Titles */}
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-ink">Pilihan Judul Video (High CTR)</span>
                  <div className="space-y-1">
                    {ytData.titles.map((t, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg border border-line bg-sand px-3 py-2 text-xs text-ink hover:border-ink/20"
                      >
                        <span className="mr-2 flex-1 truncate font-medium">{t}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={copied === `Judul ${idx + 1}` ? <Check className="size-3 text-ok-ink" /> : <Copy className="size-3" />}
                          onClick={() => void copyToClipboard(t, `Judul ${idx + 1}`)}
                        >
                          Salin
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink">Deskripsi Video SEO Lengkap</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={copied === 'Deskripsi video' ? <Check className="size-3 text-ok-ink" /> : <Copy className="size-3" />}
                      onClick={() => void copyToClipboard(ytData.description, 'Deskripsi video')}
                    >
                      Salin Deskripsi
                    </Button>
                  </div>
                  <pre className="max-h-36 select-all overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-sand p-2.5 font-sans text-xs leading-relaxed text-ink-2">
                    {ytData.description}
                  </pre>
                </div>

                {/* Thumbnail Concept */}
                <div className="space-y-2 rounded-lg border border-amber-300/80 bg-amber-50/50 p-3 text-xs dark:bg-amber-950/20">
                  <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-900 dark:text-amber-200">Konsep Thumbnail 16:9</span>
                    <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                      {ytData.thumbnailConcept.textHook}
                    </span>
                  </div>
                  <p className="leading-relaxed text-ink-2">{ytData.thumbnailConcept.composition}</p>
                  <div className="flex items-center justify-between gap-2 border-t border-amber-200/60 pt-1">
                    <span className="flex-1 truncate font-mono text-[11px] text-muted">{ytData.thumbnailConcept.prompt}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={copied === 'Prompt thumbnail' ? <Check className="size-3 text-ok-ink" /> : <Copy className="size-3" />}
                      onClick={() => void copyToClipboard(ytData.thumbnailConcept.prompt, 'Prompt thumbnail')}
                    >
                      Salin Prompt
                    </Button>
                  </div>
                </div>
              </div>
              <Button size="sm" variant="accent" icon={<ImagePlus className="size-4" />} loading={thumbnailBusy} onClick={() => void generateThumbnails()} disabled={!ytData?.thumbnailConcept.prompt}>
                Buat 3 variasi
              </Button>
              {thumbnails.length > 0 && <div className="grid grid-cols-3 gap-2">{thumbnails.slice(-6).map((asset) => <img key={asset.id} src={asset.url} alt="Thumbnail hasil generasi" className="aspect-video w-full rounded-lg border border-line object-cover" />)}</div>}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-sand/50 py-4 text-center">
                <Sparkles className="size-6 text-accent" />
                <span className="max-w-xs text-xs text-muted">
                  Klik &quot;Buat dengan AI&quot; untuk menghasilkan 3 variasi judul click-worthy, deskripsi lengkap, dan ide thumbnail 16:9.
                </span>
              </div>
            )}
          </div>
        </div>
      ) : job?.status === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="size-12 text-ok-ink" />
          <p className="text-lg font-semibold">Video selesai diekspor</p>
          <p className="break-all font-mono text-[13px] text-ink-2">{job.message}</p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button icon={<FolderOpen className="size-4" />} onClick={() => job.message && void window.api.exporter.reveal(job.message)}>
              Buka folder
            </Button>
            <Button variant="accent" icon={<Film className="size-4" />} onClick={() => setTab('youtube')}>
              Lihat Kemasan YouTube & Bab
            </Button>
            <Button icon={<RotateCcw className="size-4" />} onClick={() => setJobId(null)}>
              Ekspor lagi
            </Button>
            <Button variant="ink" onClick={onClose}>
              Selesai
            </Button>
          </div>
        </div>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-sun bg-sun-soft px-3.5 py-2.5 text-[13px] text-sun-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Klip {missing.map(({ i }) => clipNumber(i)).join(', ')} belum punya gambar. Buat gambarnya dulu di Storyboard sebelum ekspor.
              </span>
            </div>
          )}
          {missing.length === 0 && noVoice > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-line bg-sand px-3.5 py-2.5 text-[13px] text-ink-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{noVoice} klip belum punya suara narasi. Klip itu akan tampil tanpa suara dan tanpa caption.</span>
            </div>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Nama file</span>
            <div className="flex h-[46px] overflow-hidden rounded-xl border border-line-2">
              <input value={opts.fileName} onChange={(e) => set({ fileName: e.target.value })} className="flex-1 px-3.5 text-[15px] outline-none" />
              <span className="flex items-center border-l border-line-2 bg-sand px-3.5 font-mono text-sm text-ink-2">.mp4</span>
            </div>
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_170px] gap-3.5">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Resolusi</span>
              <div className="grid grid-cols-3 gap-1.5">
                {RESOLUTIONS.map((r) => {
                  const on = r.id === opts.resolution
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ resolution: r.id })}
                      className={cx('flex h-14 flex-col items-center justify-center rounded-xl', on ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 hover:border-ink-2')}
                    >
                      <span className="text-[15px] font-semibold">{r.label}</span>
                      <span className="text-xs text-ink-2">{r.sub}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Frame rate</span>
              <div className="grid grid-cols-2 gap-1.5">
                {([30, 60] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={opts.fps === f}
                    onClick={() => set({ fps: f })}
                    className={cx(
                      'h-14 rounded-xl text-[15px] font-semibold',
                      opts.fps === f ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 hover:border-ink-2'
                    )}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Encoder video</span>
            <div className={cx('grid gap-1.5', nvenc ? 'grid-cols-2' : 'grid-cols-1')}>
              <button type="button" aria-pressed={(opts.encoder ?? 'cpu') === 'cpu'} onClick={() => set({ encoder: 'cpu' })} className={cx('rounded-xl px-3 py-2.5 text-left', (opts.encoder ?? 'cpu') === 'cpu' ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 hover:border-ink-2')}>
                <span className="block text-sm font-semibold">Kualitas terbaik · CPU</span>
                <span className="text-xs text-muted">Libx264, pilihan paling kompatibel</span>
              </button>
              {nvenc && (
                <button type="button" aria-pressed={opts.encoder === 'nvenc'} onClick={() => set({ encoder: 'nvenc' })} className={cx('rounded-xl px-3 py-2.5 text-left', opts.encoder === 'nvenc' ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 hover:border-ink-2')}>
                  <span className="block text-sm font-semibold">Lebih cepat · GPU NVIDIA</span>
                  <span className="text-xs text-muted">Ukuran bisa sedikit lebih besar; otomatis kembali ke CPU jika gagal</span>
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col rounded-[14px] border border-line">
            {toggles.map((t, i) => (
              <div key={t.key} className={cx('flex items-center gap-3.5 px-3.5 py-2.5', i > 0 && 'border-t border-line', t.disabled && 'opacity-60')}>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-semibold">{t.title}</span>
                  <span className="text-[13px] text-muted">{t.desc}</span>
                </div>
                <Switch on={!!opts[t.key] && !t.disabled} onChange={(v) => !t.disabled && set({ [t.key]: v })} label={t.title} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Simpan ke</span>
            <div className="flex gap-2">
              <div className={cx(inputCls, 'flex h-11 min-w-0 flex-1 items-center gap-2.5 bg-sand font-mono text-[13px]')}>
                <FolderOpen className="size-[17px] shrink-0 text-ink-2" />
                <span className="truncate">{opts.folder}</span>
              </div>
              <Button
                className="h-11"
                onClick={async () => {
                  const f = await window.api.exporter.pickFolder()
                  if (f) set({ folder: f })
                }}
              >
                Ganti folder
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-[14px] bg-sand px-3.5 py-3">
            <div className="flex flex-col">
              <span className="text-xs text-ink-2">Durasi</span>
              <span className="font-mono text-base font-semibold">{mmss(totalMs)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-ink-2">Perkiraan ukuran</span>
              <span className="text-base font-semibold">± {sizeMb} MB</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-ink-2">Biaya</span>
              <span className="text-base font-semibold text-ok-ink">0 kredit</span>
            </div>
          </div>
          {job && (running || job.status === 'failed') && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[13px]">
                <span className={job.status === 'failed' ? 'text-bad-ink' : 'text-ink-2'}>
                  {job.status === 'failed' ? job.error : (job.message ?? 'Menyiapkan…')}
                </span>
                {running && <span className="font-mono">{Math.round(job.progress * 100)}%</span>}
              </div>
              {running && <Progress value={job.progress} />}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="flex-1 text-[13px] text-muted">
              {running && 'Kamu boleh menutup dialog ini, ekspor tetap berjalan.'}
            </span>
            {running ? (
              <Button variant="danger" onClick={() => job && void window.api.generate.cancel(job.id)}>
                Batalkan
              </Button>
            ) : (
              <Button onClick={onClose}>Batal</Button>
            )}
            <Button variant="primary" size="lg" icon={<Download className="size-[18px]" />} loading={running} disabled={missing.length > 0} onClick={() => void start()}>
              {running ? 'Mengekspor…' : 'Mulai ekspor'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
