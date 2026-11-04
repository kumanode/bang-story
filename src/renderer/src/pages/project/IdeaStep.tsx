import { useEffect, useRef, useState } from 'react'
import { Bot, Play, Sparkles, Square } from 'lucide-react'
import { getFlow2ApiModel } from '@shared/flow2api-catalog'
import { getImageModel } from '@shared/higgsfield'
import { DURATIONS, LANGUAGES, clipCountFor, llmName } from '@shared/models'
import { getStyle } from '@shared/styles'
import type { AppSettings, KeyStatus, LlmProvider, StoryPlan, TtsProvider, VoiceOption } from '@shared/types'
import { Select } from '../../components/Select'
import { StylePicker } from '../../components/StylePicker'
import { Button, Chip, Field, Segmented, confirmDialog, cx } from '../../components/ui'
import { errorText } from '../../lib/format'
import { geminiPreview } from '../../lib/voicePreviews'
import { TTS_NAMES, ttsReadiness, usableTts } from '../../lib/keys'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { ModelSection } from './ModelSection'

/** One sample plays at a time, from the list rows or the button beside the picker. */
function usePreviewPlayer(): { playing: string | null; toggle: (id: string, url: string) => void } {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  return {
    playing,
    toggle: (id, url) => {
      audio.current?.pause()
      if (playing === id) return setPlaying(null)
      const a = new Audio(url)
      a.onended = () => setPlaying(null)
      audio.current = a
      setPlaying(id)
      void a.play().catch(() => setPlaying(null))
    }
  }
}

function VoicePicker({ provider, value, onChange }: { provider: TtsProvider; value: string; onChange: (v: string) => void }) {
  const [voices, setVoices] = useState<VoiceOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const player = usePreviewPlayer()

  useEffect(() => {
    setVoices(null)
    setError(null)
    window.api.settings
      .voices(provider)
      .then((list) => {
        // Gemini samples ship with the app; ElevenLabs sends its own preview links.
        const v = provider === 'gemini' ? list.map((x) => ({ ...x, previewUrl: x.previewUrl ?? geminiPreview(x.id, x.name) })) : list
        setVoices(v)
        if (!v.some((x) => x.id === value) && v[0]) onChange(v[0].id)
      })
      .catch((e) => setError(errorText(e)))
  }, [provider])

  const urlOf = (id: string): string | null => voices?.find((v) => v.id === id)?.previewUrl ?? null
  const current = voices?.find((v) => v.id === value)

  const playButton = (id: string, size: 'row' | 'field') => {
    const url = urlOf(id)
    if (!url) return null
    const on = player.playing === id
    return (
      <button
        type="button"
        aria-label={on ? 'Hentikan contoh suara' : 'Dengarkan contoh suara'}
        title={on ? 'Hentikan' : 'Dengarkan contoh'}
        onClick={() => player.toggle(id, url)}
        className={cx(
          'flex shrink-0 items-center justify-center rounded-full border transition-colors',
          size === 'row' ? 'size-7' : 'size-12 rounded-xl',
          on ? 'border-accent bg-accent text-white' : 'border-line-2 bg-surface text-ink hover:border-ink-2'
        )}
      >
        {on ? <Square className="size-3.5" fill="currentColor" /> : <Play className="ml-px size-3.5" fill="currentColor" />}
      </button>
    )
  }

  if (error) return <p className="flex h-12 flex-1 items-center rounded-xl bg-bad-soft px-3.5 text-[13px] text-bad-ink">{error}</p>
  return (
    <>
      <Select
        label="Suara narator"
        size="lg"
        value={value}
        onChange={onChange}
        disabled={!voices}
        className="flex-1"
        menuWidth={380}
        renderAction={(o) => playButton(o.value, 'row')}
        options={
          voices
            ? voices.map((v) =>
                // Gemini tones are short; ElevenLabs labels are longer, so they go on a second line.
                provider === 'gemini' ? { value: v.id, label: v.name, hint: v.description || undefined } : { value: v.id, label: v.name, note: v.description || undefined }
              )
            : [{ value, label: 'Memuat daftar suara…' }]
        }
      />
      {current && playButton(current.id, 'field')}
    </>
  )
}

export function IdeaStep() {
  const { project, clips, updateProject, flush, load } = useProject()
  const { toast, go } = useApp()
  const [busy, setBusy] = useState(false)
  const [planMessage, setPlanMessage] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [writer, setWriter] = useState<{ provider: LlmProvider; model: string } | null>(null)
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const storyPlan = project?.storyPlan ?? null
  const hookMode = storyPlan?.hookMode ?? 'automatic'

  useEffect(() => {
    void window.api.settings.get().then((s) => {
      setSettings(s)
      setWriter({ provider: s.llmProvider, model: s.llmModels[s.llmProvider] })
    })
    void window.api.settings.keys().then(setKeys)
  }, [])

  useEffect(() => window.api.on.storyProgress((progress) => {
    if (progress.projectId === project?.id) setPlanMessage(progress.message)
  }), [project?.id])

  // Before any narration exists, move to a narrator service that has a working key.
  const hasVoice = clips.some((c) => c.audioAssetId)
  useEffect(() => {
    if (!project || !keys.length || hasVoice) return
    const use = usableTts(project.ttsProvider, keys)
    if (use !== project.ttsProvider) updateProject({ ttsProvider: use, ttsVoice: use === 'gemini' ? 'Charon' : '' })
  }, [keys, project?.id])

  if (!project) return null
  const ready = ttsReadiness(keys)
  const blocked = keys.length ? (['gemini', 'elevenlabs'] as const).filter((p) => !ready[p].ok) : []
  const openSettings = async (): Promise<void> => {
    await flush()
    go({ name: 'settings', back: { name: 'project', id: project.id } })
  }

  const clipCount = clipCountFor(project.durationSec)
  const perClip = Math.round(project.durationSec / clipCount)
  const modelName =
    settings?.defaultVisualProvider === 'flow2api'
      ? getFlow2ApiModel(settings?.flow2apiImageModel, 'image').name
      : getImageModel(project.imageModel).name
  const hasHook = !!storyPlan?.hook.trim()
  const hasOutline = !!storyPlan?.acts.length
  const actionLabel = hasOutline ? (clips.length ? 'Susun ulang naskah' : 'Buat naskah') : hasHook ? 'Susun kerangka cerita' : hookMode === 'automatic' ? 'Buat pilihan hook' : 'Isi hook untuk lanjut'
  const actionDisabled = !!busy || (!hasOutline && hookMode === 'manual' && !hasHook) || (!hasOutline && hookMode === 'automatic' && !!storyPlan?.hookOptions.length && !hasHook)

  const updateStoryPlan = (patch: Partial<StoryPlan>): void => {
    if (!project) return
    const current: StoryPlan = project.storyPlan ?? { hookMode: 'automatic', hookOptions: [], hook: '', title: '', acts: [] }
    updateProject({ storyPlan: { ...current, ...patch } })
  }

  const chooseHookMode = (mode: StoryPlan['hookMode']): void => {
    const current = project.storyPlan ?? { hookMode: mode, hookOptions: [], hook: '', title: '', acts: [] }
    updateProject({ storyPlan: { ...current, hookMode: mode, hookOptions: mode === 'manual' ? [] : current.hookOptions, hook: mode === 'manual' ? current.hook : '' , acts: [] } })
  }

  const makeHooks = async (): Promise<void> => {
    if (!project.synopsis.trim()) {
      toast('error', 'Tulis ide cerita atau sinopsis dulu.')
      return
    }
    setBusy(true)
    setPlanMessage('Mencari pilihan hook…')
    try {
      await flush()
      const hookOptions = await window.api.story.hooks(project.id)
      updateProject({ storyPlan: { hookMode: 'automatic', hookOptions, hook: hookOptions[0] ?? '', title: '', acts: [] } })
      toast('success', 'Tiga pilihan hook siap. Pilih atau edit salah satunya dulu.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
      setPlanMessage('')
    }
  }

  const makeOutline = async (): Promise<void> => {
    if (!storyPlan?.hook.trim()) {
      toast('error', 'Pilih atau tulis hook dulu.')
      return
    }
    setBusy(true)
    setPlanMessage('Menyusun kerangka cerita…')
    try {
      await flush()
      const outline = await window.api.story.outline(project.id, storyPlan.hook)
      updateProject({ storyPlan: outline })
      toast('success', 'Kerangka siap ditinjau. Kamu bisa mengubah judul dan ringkasan tiap babak.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
      setPlanMessage('')
    }
  }

  const compose = async (): Promise<void> => {
    if (!project.storyPlan?.hook.trim() || !project.storyPlan.acts.length) {
      toast('error', 'Pilih hook dan susun kerangka cerita dulu.')
      return
    }
    if (clips.length) {
      const ok = await confirmDialog({
        title: 'Susun ulang naskah?',
        body: `Proyek ini sudah punya ${clips.length} adegan. Menyusun ulang akan mengganti semua adegan beserta naskahnya. Pemeran tetap ada, sedangkan gambar dan suara lama tersimpan di riwayat tapi tidak lagi terpasang.`,
        confirm: 'Susun ulang'
      })
      if (!ok) return
    }
    setBusy(true)
    setPlanMessage('Menulis naskah dari kerangka…')
    try {
      await flush()
      const bundle = await window.api.story.script(project.id)
      load(bundle)
      toast('success', `${bundle.clips.length} adegan siap. Baca dan rapikan naskahnya dulu.`)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
      setPlanMessage('')
    }
  }

  return (
    <div className="relative h-full">
      <div className="scroll-thin h-full overflow-y-auto pb-28">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_540px] gap-10 px-14 pt-8">
          <div className="flex flex-col gap-[22px]">
            <div>
              <p className="text-[13px] font-semibold text-accent">Langkah 1 dari 4</p>
              <h1 className="mt-1.5 font-display text-[40px] font-bold leading-tight tracking-[-0.02em]">Ceritakan idemu</h1>
              <p className="mt-2 text-[15px] text-ink-2">
                Sebut tokoh, tempat, dan akhir ceritanya. Makin jelas, makin rapi susunan klip dari AI.
              </p>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-ink bg-surface px-[18px] pb-3 pt-4 shadow-ink-md">
              <label htmlFor="sinopsis" className="text-[13px] font-semibold text-ink-2">
                Ide cerita atau sinopsis
              </label>
              <textarea
                id="sinopsis"
                rows={5}
                value={project.synopsis}
                maxLength={4000}
                onChange={(e) => updateProject({ synopsis: e.target.value, storyPlan: null })}
                placeholder="Tahun 1336 di istana Majapahit. Gajah Mada bersumpah tidak akan menikmati palapa sebelum Nusantara bersatu…"
                className="resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted/70"
              />
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Tips: tulis juga suasana yang kamu mau, misalnya tegang, lucu, atau haru.</span>
                <span className="font-mono">{project.synopsis.length.toLocaleString('id-ID')} / 4.000</span>
              </div>
            </div>

            <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold">Hook pembuka</h2>
                  <p className="mt-1 text-[13px] text-ink-2">Pilih pembuka yang ingin dijanjikan ceritamu. Narasi akan dibangun untuk memenuhi hook ini.</p>
                </div>
                <Segmented
                  value={hookMode}
                  onChange={(v) => chooseHookMode(v as StoryPlan['hookMode'])}
                  options={[{ id: 'automatic', label: 'Buatkan hook' }, { id: 'manual', label: 'Tulis sendiri' }]}
                />
              </div>
              {hookMode === 'automatic' && storyPlan?.hookOptions.length ? (
                <div className="flex flex-col gap-2">
                  {storyPlan.hookOptions.map((hook, i) => (
                    <button
                      key={`${i}-${hook}`}
                      type="button"
                      aria-pressed={storyPlan.hook === hook}
                      onClick={() => updateStoryPlan({ hook, acts: [] })}
                      className={cx(
                        'rounded-xl border px-4 py-3 text-left text-sm leading-relaxed transition-colors',
                        storyPlan.hook === hook ? 'border-accent bg-accent-soft text-ink' : 'border-line-2 bg-paper text-ink-2 hover:border-ink-2'
                      )}
                    >
                      <span className="mr-2 font-mono text-xs font-semibold text-accent-dark">{i + 1}</span>{hook}
                    </button>
                  ))}
                  <button type="button" onClick={() => void makeHooks()} disabled={busy} className="self-start text-[13px] font-semibold text-accent-dark hover:underline">
                    Buat pilihan lain
                  </button>
                </div>
              ) : null}
              <textarea
                aria-label="Teks hook pembuka"
                rows={2}
                maxLength={500}
                value={storyPlan?.hook ?? ''}
                onChange={(e) => updateStoryPlan({ hook: e.target.value, acts: [] })}
                placeholder={hookMode === 'automatic' ? 'Klik “Buatkan hook” untuk melihat tiga pilihan.' : 'Tulis kalimat pembuka ceritamu…'}
                className="w-full resize-y rounded-xl border border-line-2 bg-paper px-3.5 py-3 text-sm leading-relaxed outline-none focus:border-ink-2"
              />
              {storyPlan?.acts.length ? (
                <section className="flex flex-col gap-3 border-t border-line pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-lg font-bold">Kerangka cerita</h3>
                      <p className="mt-1 text-[13px] text-ink-2">Tinjau alur dan edit ringkasannya sebelum naskah lengkap ditulis.</p>
                    </div>
                    <button type="button" onClick={() => void makeOutline()} disabled={busy || !storyPlan.hook.trim()} className="shrink-0 text-[13px] font-semibold text-accent-dark hover:underline disabled:opacity-50">
                      Susun ulang
                    </button>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-ink-2">Judul sementara</span>
                    <input
                      value={storyPlan.title}
                      onChange={(e) => updateStoryPlan({ title: e.target.value })}
                      className="rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm outline-none focus:border-ink-2"
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {storyPlan.acts.map((act, i) => (
                      <div key={i} className="flex flex-col gap-2 rounded-xl border border-line-2 bg-paper p-3.5">
                        <div className="flex items-center gap-2">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-paper">{i + 1}</span>
                          <input
                            aria-label={`Judul babak ${i + 1}`}
                            value={act.title}
                            onChange={(e) => updateStoryPlan({ acts: storyPlan.acts.map((a, n) => n === i ? { ...a, title: e.target.value } : a) })}
                            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                          />
                          <span className="shrink-0 text-[11px] text-muted">{act.scenes} adegan</span>
                        </div>
                        <textarea
                          aria-label={`Ringkasan babak ${i + 1}`}
                          rows={3}
                          value={act.summary}
                          onChange={(e) => updateStoryPlan({ acts: storyPlan.acts.map((a, n) => n === i ? { ...a, summary: e.target.value } : a) })}
                          className="resize-y rounded-lg bg-transparent text-[13px] leading-relaxed text-ink-2 outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </section>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Durasi video</span>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <Chip key={d.sec} on={project.durationSec === d.sec} onClick={() => updateProject({ durationSec: d.sec, storyPlan: null })} className="h-10 px-4">
                    {d.label}
                  </Chip>
                ))}
              </div>
              <span className="text-[13px] text-muted">
                Sekitar {clipCount} klip, masing-masing kurang lebih {perClip} detik. Durasi akhir mengikuti panjang suara narasi.
              </span>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5">
              <Field label="Bahasa naskah dan suara">
                <Select
                  label="Bahasa naskah dan suara"
                  size="lg"
                  value={project.language}
                  onChange={(v) => updateProject({ language: v, storyPlan: null })}
                  options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">Format</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: '16:9', label: '16:9', sub: 'YouTube', w: 26, h: 15 },
                      { id: '9:16', label: '9:16', sub: 'Shorts, Reels, TikTok', w: 13, h: 22 }
                    ] as const
                  ).map((f) => {
                    const on = project.aspectRatio === f.id
                    return (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => updateProject({ aspectRatio: f.id })}
                        className={cx(
                          'flex h-12 items-center gap-2.5 rounded-xl px-3 text-left',
                          on ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 bg-surface hover:border-ink-2'
                        )}
                      >
                        <span className="flex w-[26px] justify-center">
                          <span className="rounded-[3px] border-[1.8px] border-ink" style={{ width: f.w, height: f.h }} />
                        </span>
                        <span className="flex flex-col leading-tight">
                          <span className="text-sm font-semibold">{f.label}</span>
                          <span className="text-xs text-ink-2">{f.sub}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Suara narator</span>
              <div className="flex items-center gap-2">
                <Segmented
                  value={project.ttsProvider}
                  onChange={(v) => updateProject({ ttsProvider: v, ttsVoice: v === 'gemini' ? 'Charon' : '' })}
                  options={(['gemini', 'elevenlabs'] as const).map((p) => ({
                    id: p,
                    label: TTS_NAMES[p],
                    disabled: blocked.includes(p),
                    title: ready[p].reason ?? undefined
                  }))}
                />
                <VoicePicker provider={project.ttsProvider} value={project.ttsVoice} onChange={(v) => updateProject({ ttsVoice: v })} />
              </div>
              {blocked.length > 0 && (
                <span className="text-[13px] text-muted">
                  {blocked.length === 2
                    ? 'Belum ada kunci suara narator yang valid, jadi suara belum bisa dibuat.'
                    : `${ready[blocked[0]].reason}, jadi ${TTS_NAMES[blocked[0]]} belum bisa dipilih.`}{' '}
                  <button type="button" onClick={() => void openSettings()} className="font-semibold text-accent-dark hover:underline">
                    Atur di Pengaturan
                  </button>
                </span>
              )}
            </div>

            <ModelSection
              project={project}
              clipCount={clipCount}
              perClip={perClip}
              onChange={(patch) => {
                updateProject(patch)
                // New projects start with the models picked last; resolution stays with this project.
                if (!('videoResolution' in patch)) void window.api.settings.set(patch)
              }}
            />
          </div>

          <aside className="flex flex-col gap-3.5 self-start rounded-[18px] border border-line bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[22px] font-bold">Gaya visual</h2>
              <span className="text-[13px] text-muted">{getStyle(project.styleId).name}</span>
            </div>
            <p className="-mt-1.5 text-[13px] text-ink-2">Dipakai untuk semua gambar di proyek ini, termasuk lembar karakter.</p>
            <StylePicker value={project.styleId} onChange={(id) => updateProject({ styleId: id })} />
          </aside>
        </div>
      </div>

      <footer className="absolute inset-x-0 bottom-0 flex h-[84px] items-center gap-4 border-t border-line bg-surface px-14">
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">
            ± {clipCount} adegan · gambar {modelName}
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Bot className="size-3.5" />
            Disusun oleh {writer ? `${llmName(writer.provider)} · ` : ''}
            <span className={cx('font-mono', writer && !writer.model && 'text-accent-dark')}>{writer ? writer.model || 'model belum dipilih' : '…'}</span>
            <button type="button" onClick={() => void openSettings()} className="font-semibold text-accent-dark hover:underline">
              Ganti
            </button>
          </span>
        </div>
        <div className="flex-1" />
        {clips.length > 0 && !busy && (
          <Button size="lg" onClick={() => updateProject({ step: 2 })}>
            Lihat naskah
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          className="h-[50px]"
          disabled={actionDisabled}
          loading={busy}
          icon={!busy && <Sparkles className="size-[18px]" />}
          onClick={() => void (hasOutline ? compose() : hasHook ? makeOutline() : makeHooks())}
        >
          {busy ? planMessage || 'Menyiapkan…' : actionLabel}
        </Button>
      </footer>
    </div>
  )
}
