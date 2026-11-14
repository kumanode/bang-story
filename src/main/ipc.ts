import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import type {
  ApiProvider,
  AppSettings,
  AspectRatio,
  ExportOptions,
  KeyTestResult,
  ModelSource,
  NewProjectInput,
  ProjectSnapshot,
  ThumbnailRequest,
  TtsProvider,
  VoiceOption,
  WordTiming
} from '@shared/types'
import { clearExportCache, nvencAvailable, startExport } from './exporter'
import {
  estimateCredits,
  forgetEstimates,
  generateCharacterSheet,
  generateClipImage,
  generateClipTts,
  generateThumbnail,
  generateClipVideo,
  generateClipsVideo,
  generateMissingImages,
  generateMissingVideos,
  generateMissingTts,
  setActiveAsset
} from './generation'
import { cancelJob, cancelProjectJobs } from './jobs'
import { generateNarration, syncCaptions } from './narration'
import { cancelDownload, downloadModel, openModelFolder, removeModel, whisperStatus } from './whisper'
import { assetAbsPath, sfxDir } from './paths'
import { detachVoice, splitClip } from './editing'
import { emit } from './events'
import {
  createProject,
  duplicateProject,
  getAsset,
  getBundle,
  getClip,
  getProject,
  insertAsset,
  listProjects,
  patchClip,
  removeProject,
  saveSnapshot,
  touchProject,
  updateAssetMeta
} from './repo'
import { BUILTIN_SFX } from '@shared/sfx'
import type { Clip, StoryBrief, StoryStyleId } from '@shared/types'
import { clearSecret, keyStatuses, recordCheck, revealSecret, setSecret } from './secrets'
import { dropCache, getSettings, setSettings } from './settings'
import { probeDurationMs, probeSize, probeVideoCodec, toYoutubeThumbnail } from './services/audio'
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as f2a from './services/flow2api'
import * as hf from './services/higgsfield'
import * as llm from './services/llm'
import { createStyleProfile, generateBrief, generateChapterPlan, generateHooks, generateOutline, generateScript, generateVisuals, generateMusicPrompt, generateThumbnailConcept, generateYoutubeMetadata, planSmartSfx, reviseScene } from './story'


type Handler = (...args: any[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      // Only the message crosses the IPC boundary; keep it readable for the user.
      throw new Error((e as Error)?.message ?? String(e))
    }
  })
}

async function testProvider(provider: ApiProvider, key?: string): Promise<KeyTestResult> {
  if (provider === 'higgsfield') return hf.testCredentials(key)
  if (provider === 'flow2api') return f2a.testCredentials(key)
  if (provider === 'elevenlabs') return eleven.testKey(key)
  return llm.testLlm(provider, key)
}

function defaultExportFolder(): string {
  return getSettings().exportFolder ?? join(app.getPath('videos'), 'Bang Story')
}

export function registerIpc(): void {
  handle('projects:list', () => listProjects())
  handle('projects:create', (input: NewProjectInput) => getBundle(createProject(input).id))
  handle('projects:get', (id: string) => getBundle(id))
  handle('projects:save', (snap: ProjectSnapshot) => ({ updatedAt: saveSnapshot(snap) }))
  handle('projects:remove', (id: string) => {
    const removed = removeProject(id)
    clearExportCache(id)
    return removed
  })
  handle('projects:duplicate', (id: string) => duplicateProject(id))
  handle('projects:setCover', (projectId: string, clipId: string) => {
    const clip = getClip(clipId)
    if (!clip.imageAssetId) throw new Error('Klip harus memiliki gambar agar bisa dijadikan sampul proyek.')
    touchProject(projectId, { coverAssetId: clip.imageAssetId })
    return { coverAssetId: clip.imageAssetId }
  })

  handle('story:brief', (projectId: string) => generateBrief(projectId))
  handle('story:hooks', (projectId: string, brief?: StoryBrief) => generateHooks(projectId, brief ?? undefined))
  handle('story:outline', (projectId: string, hook: string, brief?: StoryBrief) => generateOutline(projectId, String(hook ?? ''), brief ?? undefined))
  handle('story:chapterPlan', (projectId: string, style: StoryStyleId, customOpening?: string) => generateChapterPlan(projectId, style, String(customOpening ?? '')))
  handle('story:styleProfile', (projectId: string, name: string, examples: string) => createStyleProfile(projectId, String(name ?? ''), String(examples ?? '')))
  handle('story:script', (projectId: string) => generateScript(projectId))
  handle('story:reviseScene', (projectId: string, clipId: string, instruction: string) => reviseScene(projectId, clipId, String(instruction ?? '')))
  handle('story:musicPrompt', (projectId: string) => generateMusicPrompt(projectId))
  handle('story:planSmartSfx', (projectId: string) => planSmartSfx(projectId))
  handle('story:generateMusic', async (projectId: string, req: { prompt: string; durationMs: number }) => {
    getProject(projectId)
    const prompt = String(req?.prompt ?? '').trim()
    if (!prompt) throw new Error('Prompt musik tidak boleh kosong.')
    const durationMs = Math.max(5000, Math.min(Number(req?.durationMs) || 60000, 300000))
    const buf = await eleven.generateMusic(prompt, { durationMs })
    const rel = `music/${randomUUID()}.mp3`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, buf)
    const actualDurationMs = await probeDurationMs(abs).catch(() => durationMs)
    const asset = insertAsset({
      projectId,
      kind: 'music',
      provider: 'elevenlabs',
      prompt,
      localPath: rel,
      durationMs: actualDurationMs
    })
    emit.asset(asset)
    return asset
  })
  handle('story:youtubeMetadata', (projectId: string) => generateYoutubeMetadata(projectId))
  handle('story:visuals', (projectId: string, mode: 'missing' | 'all') => generateVisuals(projectId, mode === 'all' ? 'all' : 'missing'))

  handle('generate:clipImage', (clipId: string) => generateClipImage(clipId))
  handle('story:thumbnailConcept', (projectId: string, title: string) => generateThumbnailConcept(projectId, String(title ?? '')))
  handle('generate:thumbnail', (projectId: string, req: ThumbnailRequest) => {
    if (!req?.prompt?.trim()) throw new Error('Prompt thumbnail masih kosong')
    if (!req.title?.trim()) throw new Error('Pilih judul dulu sebelum membuat thumbnail')
    if (!Number.isInteger(req.variation) || req.variation < 1 || req.variation > 3) throw new Error('Jumlah variasi thumbnail tidak valid')
    return generateThumbnail(projectId, {
      title: String(req.title),
      prompt: String(req.prompt),
      textHook: String(req.textHook ?? ''),
      withText: req.withText === true,
      variation: req.variation
    })
  })
  handle('generate:clipVideo', (clipId: string) => generateClipVideo(clipId))
  handle('generate:clipTts', (clipId: string) => generateClipTts(clipId))
  handle('generate:characterSheet', (characterId: string) => generateCharacterSheet(characterId))
  handle('generate:missingImages', (projectId: string) => generateMissingImages(projectId))
  handle('generate:missingVideos', (projectId: string) => generateMissingVideos(projectId))
  handle('generate:clipsVideo', (clipIds: string[]) => generateClipsVideo(clipIds))
  handle('generate:cancelProject', (projectId: string, kind?: string) => cancelProjectJobs(projectId, kind))
  handle('generate:missingTts', (projectId: string) => generateMissingTts(projectId))
  handle('generate:narration', (projectId: string, mode: 'missing' | 'all') => generateNarration(projectId, mode === 'all' ? 'all' : 'missing'))
  handle('generate:syncCaptions', (projectId: string, mode?: 'stale' | 'all' | 'force') => syncCaptions(projectId, mode === 'force' ? 'force' : mode === 'all' ? 'all' : 'stale'))

  handle('whisper:status', () => whisperStatus())
  // The download runs in the background and reports through whisper events.
  handle('whisper:download', () => {
    void downloadModel().catch(() => {})
  })
  handle('whisper:cancel', () => cancelDownload())
  handle('whisper:remove', () => removeModel())
  handle('whisper:openFolder', () => openModelFolder())
  handle('generate:cancel', (jobId: string) => cancelJob(jobId))
  handle('generate:estimate', (kind: 'image' | 'video', modelId: string, aspect: AspectRatio, seconds?: number, resolution?: string | null) =>
    estimateCredits(kind, modelId, aspect, seconds, resolution)
  )

  handle('assets:setActive', (clipId: string, assetId: string) => setActiveAsset(clipId, assetId))
  handle('clips:split', (clipId: string, atMs: number) => splitClip(clipId, Number(atMs)))
  handle('clips:detachVoice', (clipId: string) => detachVoice(clipId))
  // Caption text fixed by hand in the editor; the words keep their times.
  handle('assets:setWords', (assetId: string, words: WordTiming[]) => {
    const a = getAsset(assetId)
    if (!a || a.kind !== 'audio') throw new Error('Suara klip tidak ditemukan')
    const clean = (Array.isArray(words) ? words : [])
      .filter((w) => w && typeof w.text === 'string' && w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
      .map((w) => ({ text: w.text.trim(), start: Math.max(0, w.start), end: Math.max(w.start, w.end) }))
    updateAssetMeta(a.id, { ...a.meta, words: clean, editedWords: true })
    const fresh = getAsset(a.id)!
    emit.asset(fresh)
    return fresh
  })
  handle('assets:pickMusic', async (projectId: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pilih musik latar',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return null
    getProject(projectId)
    const src = res.filePaths[0]
    const rel = `music/${randomUUID()}${extname(src).toLowerCase()}`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(src, abs)
    const durationMs = await probeDurationMs(abs).catch(() => null)
    return insertAsset({
      projectId,
      kind: 'music',
      provider: 'local',
      prompt: src.split(/[\\/]/).pop() ?? 'musik',
      localPath: rel,
      durationMs
    })
  })

  handle('assets:pickImage', async (projectId: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pilih gambar logo atau watermark',
      filters: [{ name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return null
    getProject(projectId)
    const src = res.filePaths[0]
    const rel = `overlays/${randomUUID()}${extname(src).toLowerCase()}`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(src, abs)
    const size = await probeSize(abs).catch(() => null)
    if (!size) throw new Error('Gambar tidak bisa dibaca. Pakai file PNG, JPG, atau WebP.')
    return insertAsset({
      projectId,
      kind: 'overlay',
      provider: 'local',
      prompt: basename(src),
      localPath: rel,
      width: size.width,
      height: size.height
    })
  })

  handle('assets:listBuiltinSfx', () => BUILTIN_SFX)

  handle('assets:addBuiltinSfx', async (projectId: string, sfxId: string) => {
    const item = BUILTIN_SFX.find((s) => s.id === sfxId)
    if (!item) throw new Error('Efek suara bawaan tidak ditemukan')
    getProject(projectId)
    const src = join(sfxDir(), item.fileName)
    const durationMs = await probeDurationMs(src)
    const rel = `sfx/${randomUUID()}_${item.fileName}`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(src, abs)
    const asset = insertAsset({
      projectId,
      kind: 'sfx',
      provider: 'builtin',
      prompt: item.name,
      localPath: rel,
      durationMs
    })
    emit.asset(asset)
    return asset
  })

  handle('assets:generateSfx', async (projectId: string, req: { prompt: string; durationSec: number; name: string }) => {
    getProject(projectId)
    const prompt = String(req?.prompt ?? '').trim()
    if (!prompt) throw new Error('Prompt efek suara tidak boleh kosong.')
    const durationSeconds = Math.max(0.5, Math.min(Number(req?.durationSec) || 2.5, 22))
    const buf = await eleven.generateSoundEffect(prompt, { durationSeconds })
    const rel = `sfx/${randomUUID()}.mp3`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, buf)
    const durationMs = await probeDurationMs(abs).catch(() => Math.round(durationSeconds * 1000))
    const asset = insertAsset({
      projectId,
      kind: 'sfx',
      provider: 'elevenlabs',
      prompt: String(req?.name || prompt),
      localPath: rel,
      durationMs
    })
    emit.asset(asset)
    return asset
  })

  handle('assets:pickSfx', async (projectId: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pilih file efek suara (SFX)',
      filters: [{ name: 'Audio SFX', extensions: ['wav', 'mp3', 'ogg', 'm4a'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return null
    getProject(projectId)
    const src = res.filePaths[0]
    const rel = `sfx/${randomUUID()}${extname(src).toLowerCase()}`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(src, abs)
    const durationMs = await probeDurationMs(abs).catch(() => null)
    if (!durationMs) {
      rmSync(abs, { force: true })
      throw new Error('Durasi file tidak terbaca. Pilih file WAV, MP3, OGG, atau M4A yang valid.')
    }
    const asset = insertAsset({
      projectId,
      kind: 'sfx',
      provider: 'local',
      prompt: basename(src),
      localPath: rel,
      durationMs
    })
    emit.asset(asset)
    return asset
  })

  handle('assets:importSfx', async (projectId: string, src: string) => {
    getProject(projectId)
    const ext = extname(src).toLowerCase()
    if (!['.wav', '.mp3', '.ogg', '.m4a'].includes(ext) || !existsSync(src) || !statSync(src).isFile()) {
      throw new Error('File SFX harus berupa WAV, MP3, OGG, atau M4A.')
    }
    const rel = `sfx/${randomUUID()}${ext}`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(src, abs)
    const durationMs = await probeDurationMs(abs).catch(() => null)
    if (!durationMs) {
      rmSync(abs, { force: true })
      throw new Error('Durasi file tidak terbaca. Pilih file audio yang valid.')
    }
    const asset = insertAsset({ projectId, kind: 'sfx', provider: 'local', prompt: basename(src), localPath: rel, durationMs })
    emit.asset(asset)
    return asset
  })

  handle('assets:replaceClipMedia', async (projectId: string, clipId: string) => {
    const ownedClip = getClip(clipId)
    if (ownedClip.projectId !== projectId) throw new Error('Klip tidak cocok dengan proyek ini')
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pilih file media lokal untuk klip',
      filters: [
        { name: 'Semua Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov'] },
        { name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'Video', extensions: ['mp4', 'webm', 'mov'] }
      ],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return null
    getProject(projectId)
    const src = res.filePaths[0]
    const ext = extname(src).toLowerCase()
    const isVid = ['.mp4', '.webm', '.mov'].includes(ext)
    const kind = isVid ? 'video' : 'image'
    const rel = `${kind}s/${randomUUID()}${ext}`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(src, abs)

    const size = await probeSize(abs).catch(() => null)
    const durationMs = isVid ? await probeDurationMs(abs).catch(() => null) : null
    if (isVid) {
      const codec = await probeVideoCodec(abs)
      if (!durationMs || !codec || !['h264', 'vp8', 'vp9', 'av1'].includes(codec.toLowerCase())) {
        rmSync(abs, { force: true })
        throw new Error(`Video ${codec ?? 'ini'} tidak bisa diputar di pratinjau. Gunakan MP4 H.264 atau WebM VP8/VP9.`)
      }
    }

    const asset = insertAsset({
      projectId,
      clipId,
      kind,
      provider: 'local',
      prompt: basename(src),
      localPath: rel,
      width: size?.width ?? null,
      height: size?.height ?? null,
      durationMs
    })

    const patch: Partial<Clip> = isVid
      ? { motionType: 'video', videoAssetId: asset.id, mediaInMs: 0 }
      : { motionType: 'camera', imageAssetId: asset.id }

    patchClip(clipId, patch)
    emit.clip({ clipId, patch })
    emit.asset(asset)
    return asset
  })

  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<AppSettings>) => setSettings(patch))
  handle('settings:keys', () => keyStatuses())
  handle('settings:setKey', async (provider: ApiProvider, key: string) => {
    const clean = key.trim()
    if (!clean) throw new Error('Kunci masih kosong')
    setSecret(provider, clean)
    dropCache(`models:${provider}`)
    if (provider === 'gemini') dropCache('models:gemini-tts')
    if (provider === 'higgsfield') forgetEstimates()
    const result = await testProvider(provider, clean)
    recordCheck(provider, result.ok, result.message)
    return result
  })
  handle('settings:setCustom', async (baseUrl: string, key: string) => {
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Alamat endpoint harus diawali http:// atau https://')
    setSettings({ customBaseUrl: url })
    if (key.trim()) setSecret('custom', key.trim())
    dropCache('models:custom')
    const result = await llm.testLlm('custom', key.trim() || undefined, url)
    recordCheck('custom', result.ok, result.message)
    return result
  })
  handle('settings:setFlow2Api', async (baseUrl: string, key: string) => {
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Alamat endpoint harus diawali http:// atau https://')
    setSettings({ flow2apiBaseUrl: url })
    if (key.trim()) setSecret('flow2api', key.trim())
    const result = await f2a.testCredentials(key.trim() || undefined, url)
    recordCheck('flow2api', result.ok, result.message)
    return result
  })
  handle('settings:clearKey', (provider: ApiProvider) => {
    clearSecret(provider)
    dropCache(`models:${provider}`)
    if (provider === 'higgsfield') forgetEstimates()
    if (provider === 'custom') setSettings({ customBaseUrl: '' })
    if (provider === 'flow2api') setSettings({ flow2apiBaseUrl: 'http://localhost:8000/v1' })
  })
  handle('models:list', (source: ModelSource, refresh?: boolean) => llm.listModels(source, !!refresh))
  handle('settings:testKey', async (provider: ApiProvider) => {
    const result = await testProvider(provider).catch((e): KeyTestResult => ({ ok: false, message: (e as Error).message }))
    recordCheck(provider, result.ok, result.message)
    return result
  })
  handle('settings:revealKey', (provider: ApiProvider) => revealSecret(provider))
  handle('settings:voices', async (provider: TtsProvider): Promise<VoiceOption[]> => {
    if (provider === 'gemini') return gemini.listVoices()
    return eleven.listVoices()
  })

  handle('export:start', (projectId: string, opts: ExportOptions) => startExport(projectId, opts))
  handle('export:nvencAvailable', () => nvencAvailable())
  handle('export:defaultFolder', () => defaultExportFolder())
  handle('export:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Pilih folder ekspor',
      defaultPath: defaultExportFolder(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    setSettings({ exportFolder: res.filePaths[0] })
    return res.filePaths[0]
  })
  handle('export:reveal', (path: string) => shell.showItemInFolder(path))
  handle('export:saveThumbnail', async (assetId: string, fileName: string) => {
    const asset = getAsset(assetId)
    if (!asset || asset.kind !== 'image' || asset.meta.thumbnail !== true) throw new Error('Thumbnail tidak ditemukan')
    const win = BrowserWindow.getFocusedWindow()
    const safe = String(fileName ?? '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'thumbnail'
    const res = await dialog.showSaveDialog(win!, {
      title: 'Simpan thumbnail YouTube',
      defaultPath: join(defaultExportFolder(), `${safe}.jpg`),
      filters: [{ name: 'Gambar JPG', extensions: ['jpg'] }]
    })
    if (res.canceled || !res.filePath) return null
    mkdirSync(dirname(res.filePath), { recursive: true })
    await toYoutubeThumbnail(assetAbsPath(asset.projectId, asset.localPath), res.filePath)
    return res.filePath
  })

  handle('export:saveClipThumbnail', async (clipId: string) => {
    const clip = getClip(clipId)
    const project = getProject(clip.projectId)
    const assetId = clip.videoAssetId || clip.imageAssetId
    if (!assetId) throw new Error('Klip ini belum memiliki gambar atau video untuk dijadikan thumbnail.')
    const asset = getAsset(assetId)
    if (!asset) throw new Error('Aset visual klip tidak ditemukan.')
    const win = BrowserWindow.getFocusedWindow()
    const safeProject = String(project.title || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video'
    const safeClip = String(clip.title || `klip-${clip.sort + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'klip'
    const res = await dialog.showSaveDialog(win!, {
      title: 'Simpan Thumbnail YouTube',
      defaultPath: join(defaultExportFolder(), `${safeProject}-${safeClip}-thumbnail.jpg`),
      filters: [{ name: 'Gambar JPG', extensions: ['jpg'] }]
    })
    if (res.canceled || !res.filePath) return null
    mkdirSync(dirname(res.filePath), { recursive: true })
    await toYoutubeThumbnail(assetAbsPath(project.id, asset.localPath), res.filePath)
    return res.filePath
  })

  handle('app:version', () => app.getVersion())
  handle('app:copyText', (text: string) => clipboard.writeText(String(text)))
  handle('app:openExternal', (url: string) => {
    if (/^https:\/\//i.test(url)) return shell.openExternal(url)
    return undefined
  })
}
