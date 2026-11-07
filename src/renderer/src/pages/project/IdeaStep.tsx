import { useEffect, useRef, useState } from 'react'
import { Bot, Play, Sparkles, Square } from 'lucide-react'
import { getFlow2ApiModel } from '@shared/flow2api-catalog'
import { getImageModel } from '@shared/higgsfield'
import { DURATIONS, LANGUAGES, clipCountFor, llmName } from '@shared/models'
import { getStyle } from '@shared/styles'
import { STORY_STYLE_OPTIONS } from '@shared/storyStyles'
import type { AppSettings, KeyStatus, LlmProvider, StoryFactMode, StoryPlan, StoryStyleId, TtsProvider, VoiceOption } from '@shared/types'
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

const FACT_OPTIONS: { value: StoryFactMode; label: string }[] = [
  { value: 'factual', label: 'Fakta nyata' },
  { value: 'folklore', label: 'Cerita rakyat / horor' },
  { value: 'fiction', label: 'Fiksi' }
]

// Empty lines stay while typing so Enter works; the main process drops them before writing.
const linesOf = (text: string): string[] => text.split('\n')

export function IdeaStep() {
  const { project, clips, updateProject, flush, load } = useProject()
  const { toast, go } = useApp()
  const [busy, setBusy] = useState(false)
  const [planMessage, setPlanMessage] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [writer, setWriter] = useState<{ provider: LlmProvider; model: string } | null>(null)
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [profileName, setProfileName] = useState('')
  const [profileExamples, setProfileExamples] = useState('')
  const [creatingProfile, setCreatingProfile] = useState(false)
  const storyPlan = project?.storyPlan ?? null

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
  const hasPlan = !!storyPlan?.acts.length
  const profiles = settings?.storyStyleProfiles ?? []
  const style = storyPlan?.style ?? 'casual-education'
  const customOpening = storyPlan?.customOpening ?? storyPlan?.hook ?? ''
  const profileId = storyPlan?.styleProfileId ?? profiles[0]?.id ?? ''
  const selectedProfile = profiles.find((profile) => profile.id === profileId)
  const actionLabel = hasPlan ? (clips.length ? 'Susun ulang naskah' : 'Buat naskah') : 'Buat kerangka bab'
  const actionDisabled = !!busy || !project.synopsis.trim() || (style === 'custom-example' && profiles.length === 0)

  const updateStoryPlan = (patch: Partial<StoryPlan>): void => {
    if (!project) return
    const current: StoryPlan = project.storyPlan ?? { hookMode: 'automatic', hookOptions: [], hook: '', title: '', acts: [], style: 'casual-education', question: '', opening: '', customOpening: '', closing: '', avoid: [], factMode: 'factual', factsToVerify: [] }
    updateProject({ storyPlan: { ...current, ...patch } })
  }

  const makeChapterPlan = async (): Promise<void> => {
    setBusy(true)
    setPlanMessage('Menyusun kerangka bab…')
    try {
      await flush()
      const plan = await window.api.story.chapterPlan(project.id, style as StoryStyleId, customOpening)
      updateProject({ storyPlan: { ...plan, styleProfileId: style === 'custom-example' ? profileId : undefined } })
      toast('success', 'Kerangka bab siap ditinjau. Rapikan isinya sebelum naskah ditulis.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
      setPlanMessage('')
    }
  }

  const makeStyleProfile = async (): Promise<void> => {
    if (!profileExamples.trim()) return
    setCreatingProfile(true)
    try {
      const profile = await window.api.story.styleProfile(project.id, profileName, profileExamples)
      const nextSettings = await window.api.settings.get()
      setSettings(nextSettings)
      updateStoryPlan({ style: 'custom-example', styleProfileId: profile.id })
      setProfileExamples('')
      toast('success', 'Profil gaya tersimpan. Contoh hanya dianalisis untuk membuat aturan gaya.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setCreatingProfile(false)
    }
  }

  const saveProfileGuidance = async (guidance: string): Promise<void> => {
    if (!settings || !selectedProfile) return
    const storyStyleProfiles = profiles.map((profile) => profile.id === selectedProfile.id ? { ...profile, guidance } : profile)
    const next = await window.api.settings.set({ storyStyleProfiles })
    setSettings(next)
  }

  const deleteProfile = async (): Promise<void> => {
    if (!settings || !selectedProfile) return
    const ok = await confirmDialog({
      title: `Hapus profil “${selectedProfile.name}”?`,
      body: 'Aturan gaya ini akan dihapus dari pengaturan. Contoh narasi asalnya memang tidak disimpan.',
      confirm: 'Hapus profil',
      danger: true
    })
    if (!ok) return
    const storyStyleProfiles = profiles.filter((profile) => profile.id !== selectedProfile.id)
    setSettings(await window.api.settings.set({ storyStyleProfiles }))
    if (storyStyleProfiles.length) updateStoryPlan({ styleProfileId: storyStyleProfiles[0].id })
    else updateStoryPlan({ style: 'casual-education', styleProfileId: undefined })
  }

  const compose = async (): Promise<void> => {
    if (!project.storyPlan?.acts.length) {
      toast('error', 'Susun kerangka bab dulu.')
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
              <div>
                <h2 className="font-display text-xl font-bold">Gaya narasi</h2>
                <p className="mt-1 text-[13px] text-ink-2">Pilih cara bercerita. AI menyusun kerangka langsung dari ide kamu.</p>
              </div>
              <Field label="Gaya bercerita">
                <Select
                  label="Gaya bercerita"
                  value={style}
                  onChange={(value) => updateStoryPlan({ style: value as StoryStyleId, acts: [] })}
                  options={STORY_STYLE_OPTIONS}
                />
              </Field>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-ink-2">Kalimat pembuka sendiri (opsional)</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={customOpening}
                  onChange={(event) => updateStoryPlan({ customOpening: event.target.value })}
                  placeholder="Kosongkan agar AI memilih pembuka yang cocok dengan ide dan gaya narasi."
                  className="resize-y rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2"
                />
              </label>
              {style === 'custom-example' && (
                <div className="flex flex-col gap-3 rounded-xl border border-line-2 bg-paper p-4">
                  {profiles.length > 0 && (
                    <>
                      <div className="flex items-end gap-2">
                        <Field label="Profil gaya">
                          <Select label="Profil gaya" value={profileId} onChange={(value) => updateStoryPlan({ styleProfileId: value, acts: [] })} options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} />
                        </Field>
                        <Button size="sm" variant="secondary" onClick={() => void deleteProfile()}>Hapus profil</Button>
                      </div>
                      {selectedProfile && (
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-ink-2">Aturan gaya — boleh kamu edit</span>
                          <textarea
                            rows={5}
                            value={selectedProfile.guidance}
                            onChange={(event) => {
                              const guidance = event.target.value
                              setSettings({ ...settings!, storyStyleProfiles: profiles.map((profile) => profile.id === selectedProfile.id ? { ...profile, guidance } : profile) })
                            }}
                            onBlur={(event) => void saveProfileGuidance(event.target.value)}
                            className="resize-y rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2"
                          />
                        </label>
                      )}
                    </>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-ink-2">{profiles.length ? 'Buat profil lain dari contoh' : 'Buat profil dari contoh narasi favorit'}</span>
                    <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Nama profil, misalnya Gaya channel saya" className="rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm outline-none focus:border-ink-2" />
                    <textarea
                      rows={5}
                      maxLength={30000}
                      value={profileExamples}
                      onChange={(event) => setProfileExamples(event.target.value)}
                      placeholder="Tempel satu atau beberapa contoh narasi (minimal 300 karakter). Contoh dikirim ke penyedia AI yang kamu pilih untuk dianalisis. Yang disimpan hanya aturan gaya, bukan teks contoh."
                      className="resize-y rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2"
                    />
                  </label>
                  <Button size="sm" variant="secondary" loading={creatingProfile} disabled={!profileName.trim() || profileExamples.trim().length < 300} onClick={() => void makeStyleProfile()}>
                    Buat dan simpan profil gaya
                  </Button>
                </div>
              )}
            </section>

            {hasPlan && (
              <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-bold">Kerangka bab</h2>
                    <p className="mt-1 text-[13px] text-ink-2">Tinjau pertanyaan, pembuka, detail kunci, dan penutup. Judul bab menjadi struktur narasi, tidak dibacakan.</p>
                  </div>
                  <button type="button" onClick={() => void makeChapterPlan()} disabled={busy} className="shrink-0 text-[13px] font-semibold text-accent-dark hover:underline disabled:opacity-50">
                    Buat ulang kerangka
                  </button>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-ink-2">Judul video</span>
                  <input value={storyPlan?.title ?? ''} onChange={(event) => updateStoryPlan({ title: event.target.value })} className="rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm outline-none focus:border-ink-2" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-ink-2">Pertanyaan yang wajib terjawab</span>
                  <textarea rows={2} value={storyPlan?.question ?? ''} onChange={(event) => updateStoryPlan({ question: event.target.value })} className="resize-y rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-ink-2">Adegan pembuka</span>
                  <textarea rows={2} value={storyPlan?.opening ?? ''} onChange={(event) => updateStoryPlan({ opening: event.target.value })} className="resize-y rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Sifat isi">
                    <Select label="Sifat isi" value={storyPlan?.factMode ?? 'factual'} onChange={(value) => updateStoryPlan({ factMode: value as StoryFactMode })} options={FACT_OPTIONS} />
                  </Field>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-ink-2">Fakta untuk dicek (satu per baris)</span>
                    <textarea rows={2} value={(storyPlan?.factsToVerify ?? []).join('\n')} onChange={(event) => updateStoryPlan({ factsToVerify: linesOf(event.target.value) })} className="resize-y rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2" />
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-ink-2">Penutup</span>
                  <textarea rows={2} value={storyPlan?.closing ?? ''} onChange={(event) => updateStoryPlan({ closing: event.target.value })} className="resize-y rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-ink-2">Hindari (satu poin per baris)</span>
                  <textarea rows={2} value={(storyPlan?.avoid ?? []).join('\n')} onChange={(event) => updateStoryPlan({ avoid: linesOf(event.target.value) })} className="resize-y rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink-2" />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {storyPlan?.acts.map((act, index) => (
                    <div key={index} className="flex flex-col gap-2 rounded-xl border border-line-2 bg-paper p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-paper">{index + 1}</span>
                        <input aria-label={`Judul bab ${index + 1}`} value={act.title} onChange={(event) => updateStoryPlan({ acts: storyPlan.acts.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
                        <span className="shrink-0 text-[11px] text-muted">±{act.scenes} adegan</span>
                      </div>
                      <textarea aria-label={`Isi bab ${index + 1}`} rows={3} value={act.summary} onChange={(event) => updateStoryPlan({ acts: storyPlan.acts.map((item, i) => i === index ? { ...item, summary: event.target.value } : item) })} className="resize-y rounded-lg bg-transparent text-[13px] leading-relaxed text-ink-2 outline-none" />
                      <label className="flex flex-col gap-1 border-t border-line pt-2">
                        <span className="text-[11px] font-semibold text-muted">Satu detail kunci</span>
                        <textarea aria-label={`Detail kunci bab ${index + 1}`} rows={2} value={act.keyDetail ?? act.beats?.[0] ?? ''} onChange={(event) => updateStoryPlan({ acts: storyPlan.acts.map((item, i) => i === index ? { ...item, keyDetail: event.target.value } : item) })} className="resize-y rounded-lg bg-transparent text-[13px] leading-relaxed text-ink-2 outline-none" />
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Durasi video</span>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <Chip key={d.sec} on={project.durationSec === d.sec} onClick={() => updateProject({ durationSec: d.sec, storyPlan: storyPlan ? { ...storyPlan, acts: [] } : null })} className="h-10 px-4">
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
          onClick={() => void (hasPlan ? compose() : makeChapterPlan())}
        >
          {busy ? planMessage || 'Menyiapkan…' : actionLabel}
        </Button>
      </footer>
    </div>
  )
}
