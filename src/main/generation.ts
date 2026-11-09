import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { estimateWordTimings } from '@shared/captions'
import { stripVoiceTags } from '@shared/speech'
import { getImageModel, getVideoModel, imageBody, maxRefs, promptLimit, resolutionOptions, videoBody, type HfModel } from '@shared/higgsfield'
import { getStyle, NO_TEXT } from '@shared/styles'
import type { AspectRatio, Asset, Character, Clip, CreditEstimate, Job, Project, ThumbnailRequest, WordTiming } from '@shared/types'
import { getDb } from './db'
import { emit } from './events'
import { runJob, type TaskCtx } from './jobs'
import { assetAbsPath } from './paths'
import {
  activeJobFor,
  charactersOf,
  clipsOf,
  getAsset,
  getCharacter,
  getClip,
  getJob,
  getProject,
  insertAsset,
  insertJob,
  patchClip,
  setCharacterSheet,
  touchProject,
  unfinishedJobs,
  updateAssetMeta,
  updateJob
} from './repo'
import { dropCache, getSettings, readCache, writeCache } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as f2a from './services/flow2api'
import * as hf from './services/higgsfield'
import { getFlow2ApiModel, resolveFlow2ApiModelId, resolveFlow2ApiVideo } from '@shared/flow2api-catalog'
import { downloadTo, sleep } from './services/http'

const DAY = 24 * 60 * 60 * 1000

function extFromType(contentType: string, url: string, fallback: string): string {
  if (/png/.test(contentType)) return '.png'
  if (/jpe?g/.test(contentType)) return '.jpg'
  if (/webp/.test(contentType)) return '.webp'
  if (/mp4/.test(contentType)) return '.mp4'
  const m = /\.(png|jpe?g|webp|mp4|mov)(\?|$)/i.exec(url)
  return m ? `.${m[1].toLowerCase()}` : fallback
}

function saveFile(projectId: string, folder: string, ext: string, bytes: Buffer): string {
  const rel = `${folder}/${randomUUID()}${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  return rel
}

/** A URL Higgsfield can fetch for a stored asset: its own recent result URL, or a fresh upload. */
async function publicUrlFor(asset: Asset, signal: AbortSignal): Promise<string> {
  if (asset.remoteUrl && asset.provider === 'higgsfield' && Date.now() - asset.createdAt < 6 * DAY) return asset.remoteUrl
  const up = asset.meta.uploadedUrl as string | undefined
  const at = asset.meta.uploadedAt as number | undefined
  if (up && at && Date.now() - at < 0.5 * DAY) return up
  const url = await hf.uploadFile(assetAbsPath(asset.projectId, asset.localPath), signal)
  updateAssetMeta(asset.id, { ...asset.meta, uploadedUrl: url, uploadedAt: Date.now() })
  return url
}

function imageProgress(ctx: TaskCtx, what: string) {
  return (status: hf.HfStatus, elapsed: number): void => {
    if (status === 'queued') ctx.progress(0.12, 'Mengantre di Higgsfield')
    else ctx.progress(0.12, `${what} · ${Math.floor(elapsed / 1000)} dtk`)
  }
}

// ---------- prompts ----------

function characterLine(c: Character): string {
  return `${c.name}: ${c.description}`
}

/** Splits the storyboard's "Avoid:" line off the scene, so it can be phrased as a clear instruction. */
function splitAvoid(visual: string): { scene: string; avoid: string } {
  const lines = visual.split('\n')
  const i = lines.findIndex((l) => /^\s*avoid\s*:/i.test(l))
  if (i < 0) return { scene: visual.trim(), avoid: '' }
  const avoid = lines[i].replace(/^\s*avoid\s*:\s*/i, '').replace(/\.$/, '').trim()
  lines.splice(i, 1)
  return { scene: lines.join('\n').trim(), avoid }
}

/**
 * The image prompt for a clip. The scene comes first so the model gets the content right, then who the
 * characters are, then the art style. Clothing follows the scene's Wardrobe line when it has one, so a
 * character can change out of the outfit on their reference sheet (no spacesuit indoors).
 */
function clipPrompt(project: Project, clip: Clip, chars: Character[], refNames: string[], limit: number): string {
  const style = getStyle(project.styleId)
  const { scene, avoid } = splitAvoid(clip.visualPrompt)
  const wardrobe = /^\s*wardrobe\s*:/im.test(scene)
  const parts = [`Scene:\n${scene}`]
  if (chars.length)
    parts.push(
      `Recurring characters in this scene. Keep each one's body, face, hair and skin exactly as described${refNames.length ? ' and as on their reference sheet' : ''}.` +
        (wardrobe
          ? ' Their clothing follows the Wardrobe line of the scene: the default outfit only where it says so, otherwise the custom outfit.'
          : ' They wear their default outfit.') +
        `\n${chars.map(characterLine).join('\n')}`
    )
  if (refNames.length)
    parts.push(
      `Reference images are character sheets, in this order: ${refNames.join(', ')}. Use them for each character's identity, proportions and colors. ` +
        (wardrobe ? 'Copy the costume from a sheet only for characters whose Wardrobe line says "default outfit". ' : 'Match the costume to the sheet. ') +
        'Do not copy the sheet layout, poses or plain background.'
    )
  parts.push(`Art style: ${style.prompt}`)
  if (avoid) parts.push(`Must not appear in the image: ${avoid}.`)
  parts.push(`Frame format ${project.aspectRatio}, full-bleed composition.`)
  const full = parts.join('\n\n')
  if (full.length <= limit) return full
  // Models with short prompt limits get the scene first, so trimming only loses style detail.
  return [scene, chars.map(characterLine).join('; '), avoid && `Must not appear: ${avoid}.`, style.prompt].filter(Boolean).join('\n\n')
}

function sheetPrompt(project: Project, c: Character): string {
  const style = getStyle(project.styleId)
  return [
    style.prompt,
    `Character reference sheet for "${c.name}": ${c.description}. The character is ${style.characterHint}.`,
    'Show the SAME character three times side by side: front view, three-quarter view and side view, full body, neutral standing pose, evenly spaced, on a plain light neutral background (this overrides any background instruction above). Consistent proportions, costume and colors in all three views.'
  ].join('\n\n')
}

// ---------- waiting for character sheets ----------

async function waitForSheets(characterIds: string[], signal: AbortSignal): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 15 * 60 * 1000) {
    const pending = characterIds.some((id) => activeJobFor({ characterId: id }, 'sheet'))
    if (!pending) return
    await sleep(2000, signal)
  }
}

async function referenceUrls(model: HfModel, chars: Character[], signal: AbortSignal): Promise<{ urls: string[]; names: string[] }> {
  const limit = maxRefs(model)
  if (limit === 0) return { urls: [], names: [] }
  await waitForSheets(
    chars.map((c) => c.id),
    signal
  )
  const urls: string[] = []
  const names: string[] = []
  for (const c of chars) {
    const fresh = getCharacter(c.id)
    const sheet = getAsset(fresh.sheetAssetId)
    if (!sheet || urls.length >= limit) continue
    urls.push(await publicUrlFor(sheet, signal))
    names.push(fresh.name)
  }
  return { urls, names }
}

// ---------- finishing a Higgsfield request (also used to resume after a restart) ----------

interface HfPayload {
  target: 'clip-image' | 'sheet' | 'clip-video' | 'thumbnail'
  model: string
  prompt: string
  resolution?: string
}

async function finishHiggsfield(ctx: TaskCtx, job: Job, requestId: string, payload: HfPayload): Promise<string> {
  const isVideo = payload.target === 'clip-video'
  const result = await hf.waitForResult(
    requestId,
    imageProgress(ctx, isVideo ? 'Membuat video' : payload.target === 'sheet' ? 'Membuat lembar karakter' : 'Membuat gambar'),
    ctx.signal,
    isVideo ? 30 * 60 * 1000 : 15 * 60 * 1000
  )
  const url = isVideo ? result.video?.url : result.images?.[0]?.url
  if (!url) throw new Error('Higgsfield selesai tanpa file hasil')
  ctx.progress(0.93, 'Mengunduh hasil')
  const downloadStartedAt = Date.now()
  const { bytes, contentType } = await downloadTo(url, ctx.signal)
  if (ctx.signal.aborted) throw new Error('Dibatalkan')
  console.info('[higgsfield] download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
  const rel = saveFile(job.projectId, isVideo ? 'videos' : 'images', extFromType(contentType, url, isVideo ? '.mp4' : '.png'), bytes)
  const abs = assetAbsPath(job.projectId, rel)
  const size = await probeSize(abs)
  const durationMs = isVideo ? await probeDurationMs(abs).catch(() => null) : null
  if (ctx.signal.aborted) throw new Error('Dibatalkan')
  const asset = insertAsset({
    projectId: job.projectId,
    clipId: job.clipId,
    characterId: job.characterId,
    kind: isVideo ? 'video' : 'image',
    provider: 'higgsfield',
    model: payload.model,
    prompt: payload.prompt,
    remoteId: requestId,
    remoteUrl: url,
    localPath: rel,
    durationMs,
    width: size?.width ?? null,
    height: size?.height ?? null,
    // Thumbnails have no clip; the flag is how the export dialog finds them again.
    meta: { ...(payload.target === 'thumbnail' ? { thumbnail: true } : {}), ...(payload.resolution ? { resolution: payload.resolution } : {}) }
  })
  emit.asset(asset)
  if (payload.target === 'sheet' && job.characterId) {
    setCharacterSheet(job.characterId, asset.id)
    emit.character({ characterId: job.characterId, patch: { sheetAssetId: asset.id } })
  } else if (payload.target === 'clip-image' && job.clipId) {
    patchClip(job.clipId, { imageAssetId: asset.id })
    emit.clip({ clipId: job.clipId, patch: { imageAssetId: asset.id } })
    const project = getProject(job.projectId)
    const first = clipsOf(job.projectId)[0]
    if (!project.coverAssetId || first?.id === job.clipId) touchProject(job.projectId, { coverAssetId: asset.id })
  } else if (payload.target === 'clip-video' && job.clipId) {
    const patch = { videoAssetId: asset.id, motionType: 'video' as const, mediaInMs: 0 }
    patchClip(job.clipId, patch)
    emit.clip({ clipId: job.clipId, patch })
  }
  touchProject(job.projectId)
  return asset.id
}

function startHiggsfield(job: Job, build: (ctx: TaskCtx) => Promise<{ endpoint: string; body: Record<string, unknown>; payload: HfPayload }>): Job {
  emit.job(job)
  return runJob(job, 'higgsfield', async (ctx) => {
    ctx.progress(0.04, 'Menyiapkan prompt')
    const { endpoint, body, payload } = await build(ctx)
    if (typeof body.resolution === 'string' || typeof body.resolution === 'number') payload.resolution = String(body.resolution)
    ctx.progress(0.08, 'Mengirim ke Higgsfield')
    const submitStartedAt = Date.now()
    const requestId = await hf.submit(endpoint, body, ctx.signal)
    console.info('[higgsfield] submit accepted', { model: payload.model, elapsedMs: Date.now() - submitStartedAt })
    ctx.setRemote(requestId)
    updateJobPayload(job.id, payload)
    return finishHiggsfield(ctx, job, requestId, payload)
  })
}

function updateJobPayload(jobId: string, payload: HfPayload): void {
  getDb().prepare('UPDATE jobs SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), jobId)
}

function isFlow2Api(): boolean {
  return getSettings().defaultVisualProvider === 'flow2api'
}

// ---------- public entry points ----------

export function generateClipImage(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'image')
  if (existing) return existing
  const clip = getClip(clipId)
  if (isFlow2Api()) {
    const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const fresh = getClip(clipId)
      const project = getProject(fresh.projectId)
      const chars = charactersOf(project.id).filter((c) => fresh.characterIds.includes(c.id))
      await waitForSheets(chars.map((c) => c.id), ctx.signal)

      const refBuffers: Buffer[] = []
      for (const c of chars) {
        const freshChar = getCharacter(c.id)
        const sheet = getAsset(freshChar.sheetAssetId)
        if (sheet && refBuffers.length < 3) {
          const abs = assetAbsPath(project.id, sheet.localPath)
          if (existsSync(abs)) refBuffers.push(readFileSync(abs))
        }
      }

      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
      const modelId = resolveFlow2ApiModelId(baseModel, project.aspectRatio)
      const prompt = clipPrompt(project, fresh, chars, chars.map((c) => c.name), 4000)

      ctx.progress(0.04, 'Menyiapkan prompt Flow2API')
      const { mediaUrl } = await f2a.generateImage({
        prompt,
        model: modelId,
        referenceImages: refBuffers,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh hasil')
      const downloadStartedAt = Date.now()
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      console.info('[flow2api] download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
      const rel = saveFile(project.id, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        clipId: fresh.id,
        kind: 'image',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        width: size?.width ?? null,
        height: size?.height ?? null
      })
      emit.asset(asset)
      patchClip(clipId, { imageAssetId: asset.id })
      emit.clip({ clipId, patch: { imageAssetId: asset.id } })
      const first = clipsOf(project.id)[0]
      if (!project.coverAssetId || first?.id === clipId) touchProject(project.id, { coverAssetId: asset.id })
      touchProject(project.id)
      return asset.id
    })
  }

  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const project = getProject(fresh.projectId)
    const model = getImageModel(project.imageModel)
    const chars = charactersOf(project.id).filter((c) => fresh.characterIds.includes(c.id))
    const refs = await referenceUrls(model, chars, ctx.signal)
    const prompt = clipPrompt(project, fresh, chars, refs.names, promptLimit(model))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, project.aspectRatio, refs.urls, getSettings().imageGenerationMode === 'draft' ? resolutionOptions(model)[0] : undefined),
      payload: { target: 'clip-image', model: model.id, prompt }
    }
  })
}

/** The characters in the most scenes: thumbnails show the lead, not the whole cast. */
function leadCharacters(projectId: string, max: number): Character[] {
  const count = new Map<string, number>()
  for (const clip of clipsOf(projectId)) for (const id of clip.characterIds) count.set(id, (count.get(id) ?? 0) + 1)
  return charactersOf(projectId)
    .filter((c) => count.has(c.id))
    .sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0))
    .slice(0, max)
}

function thumbnailPrompt(project: Project, req: ThumbnailRequest, chars: Character[], refNames: string[]): string {
  const drawText = req.withText && !!req.textHook.trim()
  // Every style forbids text for scene frames; left in, it fights the hook instruction and models drop the text.
  const stylePrompt = drawText ? getStyle(project.styleId).prompt.replace(NO_TEXT, '').trim() : getStyle(project.styleId).prompt
  const parts = [
    `YouTube thumbnail, 16:9, for a video titled "${req.title.trim()}".`,
    `Scene:\n${req.prompt.trim()}`
  ]
  if (chars.length) parts.push(`Characters, keep their look exactly:\n${chars.map(characterLine).join('\n')}`)
  if (refNames.length)
    parts.push(
      `Reference images are character sheets, in this order: ${refNames.join(', ')}. Use them for identity, face and colors only; do not copy the sheet layout or background.`
    )
  // Image models misspell long text, so only the short hook is drawn; the title itself stays in YouTube's title field.
  parts.push(
    drawText
      ? `Draw the text "${req.textHook.trim()}" exactly as written, huge bold sans-serif capital letters with a thick dark outline, filling about a third of the frame on the empty side, fully inside the frame. No other text, logos or watermarks.`
      : 'No text, letters, logos or watermarks anywhere. Leave clean empty space on one side for a title added later.'
  )
  parts.push(
    'Thumbnail rules: one clear focal subject close to the camera with a strong readable facial expression, bold contrast, saturated colors, uncluttered background, readable at small size.'
  )
  parts.push(`Art style: ${stylePrompt}`)
  parts.push(`Variation ${req.variation}: use a distinct camera angle, pose and expression from the other variations.`)
  return parts.join('\n\n')
}

export function generateThumbnail(projectId: string, req: ThumbnailRequest): Job {
  const project = getProject(projectId)
  const variation = req.variation
  const chars = leadCharacters(projectId, 2)
  if (isFlow2Api()) {
    const job = insertJob({ projectId, kind: 'image', provider: 'flow2api', payload: { target: 'thumbnail', variation } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      await waitForSheets(chars.map((c) => c.id), ctx.signal)
      const refBuffers: Buffer[] = []
      const refNames: string[] = []
      for (const c of chars) {
        const sheet = getAsset(getCharacter(c.id).sheetAssetId)
        const abs = sheet && assetAbsPath(projectId, sheet.localPath)
        if (abs && existsSync(abs)) {
          refBuffers.push(readFileSync(abs))
          refNames.push(c.name)
        }
      }
      const variedPrompt = thumbnailPrompt(project, req, chars, refNames)
      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
      const modelId = resolveFlow2ApiModelId(baseModel, '16:9')
      const { mediaUrl } = await f2a.generateImage({ prompt: variedPrompt, model: modelId, referenceImages: refBuffers, signal: ctx.signal, onProgress: (progress, message) => ctx.progress(progress, message) })
      const downloadStartedAt = Date.now()
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      console.info('[flow2api] thumbnail download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
      const rel = saveFile(projectId, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const size = await probeSize(assetAbsPath(projectId, rel))
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({ projectId, kind: 'image', provider: 'flow2api', model: modelId, prompt: variedPrompt, remoteUrl: mediaUrl, localPath: rel, width: size?.width ?? null, height: size?.height ?? null, meta: { thumbnail: true } })
      emit.asset(asset)
      return asset.id
    })
  }
  const job = insertJob({ projectId, kind: 'image', provider: 'higgsfield', payload: { target: 'thumbnail', variation } })
  return startHiggsfield(job, async (ctx) => {
    const model = getImageModel(project.imageModel)
    const refs = await referenceUrls(model, chars, ctx.signal)
    const variedPrompt = thumbnailPrompt(project, req, chars, refs.names)
    return {
      endpoint: model.id,
      body: imageBody(model, variedPrompt, '16:9', refs.urls),
      payload: { target: 'thumbnail', model: model.id, prompt: variedPrompt }
    }
  })
}

export function generateCharacterSheet(characterId: string): Job {
  const existing = activeJobFor({ characterId }, 'sheet')
  if (existing) return existing
  const c = getCharacter(characterId)
  if (isFlow2Api()) {
    const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const project = getProject(c.projectId)
      const prompt = sheetPrompt(project, getCharacter(characterId))
      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
      const modelId = resolveFlow2ApiModelId(baseModel, '16:9')

      ctx.progress(0.04, 'Menyiapkan prompt lembar karakter Flow2API')
      const { mediaUrl } = await f2a.generateImage({
        prompt,
        model: modelId,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh lembar karakter')
      const downloadStartedAt = Date.now()
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      console.info('[flow2api] character sheet download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
      const rel = saveFile(project.id, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        characterId,
        kind: 'image',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        width: size?.width ?? null,
        height: size?.height ?? null
      })
      setCharacterSheet(characterId, asset.id)
      emit.character({ characterId, patch: { sheetAssetId: asset.id } })
      emit.asset(asset)
      touchProject(c.projectId)
      return asset.id
    })
  }

  const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'higgsfield' })
  return startHiggsfield(job, async () => {
    const project = getProject(c.projectId)
    const model = getImageModel(project.imageModel)
    const prompt = sheetPrompt(project, getCharacter(characterId))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
      payload: { target: 'sheet', model: model.id, prompt }
    }
  })
}

export function generateClipVideo(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'video')
  if (existing) return existing
  const clip = getClip(clipId)
  if (!clip.imageAssetId) throw new Error('Buat gambar klip ini dulu sebelum membuat video AI.')
  if (isFlow2Api()) {
    const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const fresh = getClip(clipId)
      const image = getAsset(fresh.imageAssetId)
      if (!image) throw new Error('Gambar klip tidak ditemukan')
      const project = getProject(fresh.projectId)

      const imgAbs = assetAbsPath(project.id, image.localPath)
      if (!existsSync(imgAbs)) throw new Error('File gambar klip tidak ditemukan di disk')
      const imgBuffer = readFileSync(imgAbs)

      const durationSec = Math.max(4, Math.round(fresh.durationMs / 1000))
      const baseModel = (project.videoModel && !project.videoModel.includes('/') ? project.videoModel : null) ?? getSettings().flow2apiVideoModel
      const video = resolveFlow2ApiVideo(baseModel, project.aspectRatio, durationSec)
      const modelId = video.model

      const prompt =
        fresh.videoPrompt.trim() ||
        `${splitAvoid(fresh.visualPrompt).scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, the camera slowly pushes in. Keep the art style of the first frame.`

      ctx.progress(0.04, 'Menyiapkan video Flow2API (Veo)')
      const { mediaUrl } = await f2a.generateVideo({
        prompt,
        model: modelId,
        aspectRatio: video.aspectRatio,
        durationSec: video.durationSec,
        initialImage: video.withImage ? imgBuffer : undefined,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh video hasil')
      const downloadStartedAt = Date.now()
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      console.info('[flow2api] video download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
      const rel = saveFile(project.id, 'videos', extFromType(contentType, mediaUrl, '.mp4'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      const durationMs = await probeDurationMs(abs).catch(() => null)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        clipId: fresh.id,
        kind: 'video',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        durationMs,
        width: size?.width ?? null,
        height: size?.height ?? null
      })
      emit.asset(asset)
      const patch = { videoAssetId: asset.id, motionType: 'video' as const, mediaInMs: 0 }
      patchClip(clipId, patch)
      emit.clip({ clipId, patch })
      touchProject(project.id)
      return asset.id
    })
  }

  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const image = getAsset(fresh.imageAssetId)
    if (!image) throw new Error('Gambar klip tidak ditemukan')
    const project = getProject(fresh.projectId)
    const model = getVideoModel(project.videoModel)
    ctx.progress(0.05, 'Menyiapkan gambar awal')
    const url = await publicUrlFor(image, ctx.signal)
    let prompt =
      fresh.videoPrompt.trim() ||
      `${splitAvoid(fresh.visualPrompt).scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, the camera slowly pushes in. Keep the art style of the first frame.`
    if (model.input.mode === 'reference')
      prompt = `Open on the exact scene of the reference image and keep its art style, characters and composition. ${prompt}`
    let audioUrl: string | null = null
    if (fresh.audioAssetId && (model.props.audio_url || model.props.audio_urls)) {
      const audio = getAsset(fresh.audioAssetId)
      if (audio) {
        audioUrl = await publicUrlFor(audio, ctx.signal)
      }
    }
    return {
      endpoint: model.id,
      body: videoBody(model, prompt, url, fresh.durationMs / 1000, project.aspectRatio, project.videoResolution, audioUrl),
      payload: { target: 'clip-video', model: model.id, prompt }
    }
  })
}

export function generateClipTts(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'tts')
  if (existing) return existing
  const clip = getClip(clipId)
  const project = getProject(clip.projectId)
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'tts', provider: project.ttsProvider })
  emit.job(job)
  return runJob(job, 'tts', async (ctx) => {
    const fresh = getClip(clipId)
    const p = getProject(fresh.projectId)
    const text = fresh.narration.trim()
    if (!text) throw new Error('Naskah klip ini masih kosong')
    ctx.progress(0.2, 'Membuat suara')
    let rel: string
    let words: WordTiming[] | undefined
    let estimated = false
    const char = fresh.speakerId ? charactersOf(p.id).find((c) => c.id === fresh.speakerId) : null
    const charVoice = char?.ttsProvider === p.ttsProvider ? char.ttsVoice : null
    const voice = charVoice || p.ttsVoice || (p.ttsProvider === 'gemini' ? 'Charon' : '')
    if (p.ttsProvider === 'elevenlabs') {
      if (!voice) throw new Error('Pilih suara ElevenLabs dulu di langkah Ide cerita.')
      const out = await eleven.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.mp3', out.audio)
      words = out.words
    } else {
      const wav = await gemini.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.wav', wav)
    }
    ctx.progress(0.85, 'Mengukur durasi')
    const audioMs = await probeDurationMs(assetAbsPath(p.id, rel))
    if (!words?.length) {
      words = estimateWordTimings(stripVoiceTags(text), audioMs / 1000)
      estimated = true
    }
    const asset = insertAsset({
      projectId: p.id,
      clipId,
      kind: 'audio',
      provider: p.ttsProvider,
      model: p.ttsProvider === 'gemini' ? getSettings().geminiTtsModel : getSettings().elevenModel,
      prompt: text,
      localPath: rel,
      durationMs: audioMs,
      meta: { words, estimatedTimings: estimated, voice }
    })
    emit.asset(asset)
    const durationMs = Math.max(1500, audioMs + 400)
    const patch = { audioAssetId: asset.id, durationMs, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
    patchClip(clipId, patch)
    emit.clip({ clipId, patch })
    touchProject(p.id)
    return asset.id
  })
}

export function generateMissingImages(projectId: string): Job[] {
  const jobs: Job[] = []
  const project = getProject(projectId)
  const canRef = isFlow2Api()
    ? getFlow2ApiModel(project.imageModel || getSettings().flow2apiImageModel, 'image').supportsRef
    : maxRefs(getImageModel(project.imageModel)) > 0
  if (canRef) {
    const needed = new Set(clipsOf(projectId).flatMap((c) => c.characterIds))
    for (const c of charactersOf(projectId)) {
      if (needed.has(c.id) && !c.sheetAssetId) jobs.push(generateCharacterSheet(c.id))
    }
  }
  for (const clip of clipsOf(projectId)) {
    if (!clip.imageAssetId) jobs.push(generateClipImage(clip.id))
  }
  return jobs
}

/** Turns every clip that has an image but no AI video yet into a video. */
/** Generates AI video for specific clips that have an image. */
export function generateClipsVideo(clipIds: string[]): Job[] {
  if (!clipIds.length) return []
  for (const id of clipIds) {
    const clip = getClip(id)
    if (!clip.imageAssetId) {
      throw new Error(`Klip "${clip.title || id}" belum memiliki gambar. Buat gambarnya dulu sebelum dijadikan video.`)
    }
  }
  return clipIds.map((id) => generateClipVideo(id))
}

export function generateClipLipSync(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'video')
  if (existing) return existing
  const clip = getClip(clipId)
  if (!clip.imageAssetId) throw new Error('Buat gambar klip ini dulu sebelum membuat video Lip Sync.')

  const project = getProject(clip.projectId)
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const image = getAsset(fresh.imageAssetId)
    if (!image) throw new Error('Gambar klip tidak ditemukan')

    let audioAsset = fresh.audioAssetId ? getAsset(fresh.audioAssetId) : null
    if (!audioAsset && fresh.narration.trim()) {
      ctx.progress(0.04, 'Membuat suara narasi/dialog dulu')
      generateClipTts(clipId)
      const started = Date.now()
      while (Date.now() - started < 3 * 60 * 1000) {
        const pending = activeJobFor({ clipId }, 'tts')
        if (!pending) break
        await sleep(1500, ctx.signal)
      }
      const afterTts = getClip(clipId)
      audioAsset = afterTts.audioAssetId ? getAsset(afterTts.audioAssetId) : null
    }

    if (!audioAsset) throw new Error('Belum ada audio suara untuk klip ini. Tulis naskah atau buat suara narasi dulu.')

    const projModel = getVideoModel(project.videoModel)
    const supportsAudio = !!(projModel.props.audio_url || projModel.props.audio_urls)
    const model = supportsAudio ? projModel : getVideoModel('wan/v2.7/image-to-video')

    ctx.progress(0.08, 'Menyiapkan gambar dan suara untuk Lip Sync')
    const imgUrl = await publicUrlFor(image, ctx.signal)
    const audioUrl = await publicUrlFor(audioAsset, ctx.signal)

    const basePrompt = fresh.videoPrompt.trim() || `${splitAvoid(fresh.visualPrompt).scene.replace(/\.$/, '')}`
    const lipSyncPrompt = `Close-up or medium shot of the character speaking naturally with synchronized mouth and lip movements matching the speech audio. ${basePrompt}`

    return {
      endpoint: model.id,
      body: videoBody(model, lipSyncPrompt, imgUrl, fresh.durationMs / 1000, project.aspectRatio, project.videoResolution, audioUrl),
      payload: { target: 'clip-video', model: model.id, prompt: lipSyncPrompt }
    }
  })
}

export function generateClipsLipSync(clipIds: string[]): Job[] {
  if (!clipIds.length) return []
  for (const id of clipIds) {
    const clip = getClip(id)
    if (!clip.imageAssetId) {
      throw new Error(`Klip "${clip.title || id}" belum memiliki gambar. Buat gambarnya dulu sebelum dijadikan video lip sync.`)
    }
  }
  return clipIds.map((id) => generateClipLipSync(id))
}

export function generateMissingVideos(projectId: string): Job[] {
  const clips = clipsOf(projectId)
  if (clips.some((c) => !c.imageAssetId)) throw new Error('Buat gambar semua klip dulu sebelum menjadikannya video.')
  return clips.filter((c) => !c.videoAssetId).map((c) => generateClipVideo(c.id))
}

export function generateMissingTts(projectId: string): Job[] {
  return clipsOf(projectId)
    .filter((c) => !c.audioAssetId && c.narration.trim())
    .map((c) => generateClipTts(c.id))
}

/** After a restart, keep polling Higgsfield requests that were already submitted; fail the rest. */
export function resumeJobs(): void {
  for (const row of unfinishedJobs()) {
    const payload = JSON.parse(row.payload_json || '{}') as Partial<HfPayload>
    if (row.provider === 'higgsfield' && row.remote_id && payload.target) {
      const job = getJob(row.id)!
      runJob(job, 'higgsfield', (ctx) => finishHiggsfield(ctx, job, row.remote_id, payload as HfPayload))
    } else {
      emit.job(updateJob(row.id, { status: 'failed', error: 'Terhenti karena aplikasi ditutup. Coba lagi.', message: null }))
    }
  }
}

export async function setActiveAsset(clipId: string, assetId: string): Promise<void> {
  const asset = getAsset(assetId)
  if (!asset || asset.clipId !== clipId) throw new Error('Aset tidak cocok dengan klip ini')
  const patch: Partial<Clip> =
    asset.kind === 'image'
      ? { imageAssetId: asset.id }
      : asset.kind === 'video'
        ? { videoAssetId: asset.id, mediaInMs: 0 }
        : asset.kind === 'audio'
          ? { audioAssetId: asset.id, durationMs: Math.max(1500, (asset.durationMs ?? 0) + 400), voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
          : {}
  patchClip(clipId, patch)
  emit.clip({ clipId, patch })
}

/** Estimates that failed recently (no key, or a model the account cannot use), so pickers do not keep asking. */
const failedEstimates = new Map<string, number>()

/**
 * Credits for one image, or one clip video of about `seconds`. The model pickers ask for every model,
 * so answers are kept for a day and failures for ten minutes.
 */
export async function estimateCredits(
  kind: 'image' | 'video',
  modelId: string,
  aspect: AspectRatio,
  seconds = 5,
  resolution?: string | null
): Promise<CreditEstimate | null> {
  if (isFlow2Api()) return null
  const model = kind === 'image' ? getImageModel(modelId) : getVideoModel(modelId)
  const body =
    kind === 'image'
      ? imageBody(model, 'estimate', aspect, [])
      : videoBody(model, 'estimate', 'https://example.com/frame.png', seconds, aspect, resolution)
  const key = `estimate:${model.id}:${JSON.stringify(body)}`
  const hit = readCache<CreditEstimate>(key)
  if (hit && Date.now() - hit.updatedAt < DAY) return hit.value
  const failedAt = failedEstimates.get(key)
  if (failedAt && Date.now() - failedAt < 10 * 60 * 1000) return null
  const value = await hf.estimate(model.id, body)
  if (value) writeCache(key, value)
  else failedEstimates.set(key, Date.now())
  return value
}

/** Prices can differ per account, so a new Higgsfield key starts from fresh estimates. */
export function forgetEstimates(): void {
  failedEstimates.clear()
  dropCache('estimate:')
}
