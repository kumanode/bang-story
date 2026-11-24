import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync } from 'node:fs'
import { cpus } from 'node:os'
import { basename, join } from 'node:path'
import { once } from 'node:events'
import { app, shell } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import type { WhisperStatus } from '@shared/types'
import { alignWords, splitHeard, type Heard } from './align'
import { emit } from './events'
import { binPath, dataDir } from './paths'
import { getSettings, setSettings } from './settings'

/**
 * Local speech recognition with whisper.cpp (bundled `whisper-cli`) using either the downloaded
 * Whisper Small model or an existing GGML `.bin` model selected manually by the user.
 */

const MODEL = {
  file: 'ggml-small.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  bytes: 487_601_967,
  sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
}

const GGML_MAGIC = 0x67676d6c
const MIN_MODEL_BYTES = 1024 * 1024

interface GgmlHeader {
  nVocab: number
  nAudioLayer: number
  nTextLayer: number
  nMels: number
}

/** Reads the 48-byte whisper.cpp GGML header to verify the file and identify its architecture. */
function readGgmlHeader(file: string): GgmlHeader | null {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(48)
    const read = readSync(fd, buf, 0, 48, 0)
    if (read < 48 || buf.readUInt32LE(0) !== GGML_MAGIC) return null
    const nVocab = buf.readInt32LE(4)
    const nAudioLayer = buf.readInt32LE(20)
    const nTextLayer = buf.readInt32LE(36)
    const nMels = buf.readInt32LE(40)
    if (nAudioLayer <= 0 || nAudioLayer > 64 || nTextLayer <= 0 || nTextLayer > 64) return null
    if (nMels !== 80 && nMels !== 128) return null
    return { nVocab, nAudioLayer, nTextLayer, nMels }
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Matches whisper.cpp's `-dtw` preset to the model architecture so DTW never reads out-of-bounds layers. */
function detectDtwPreset(file: string, header: GgmlHeader): string | null {
  const en = header.nVocab === 51864
  if (header.nAudioLayer === 4 && header.nTextLayer === 4) return en ? 'tiny.en' : 'tiny'
  if (header.nAudioLayer === 6 && header.nTextLayer === 6) return en ? 'base.en' : 'base'
  if (header.nAudioLayer === 12 && header.nTextLayer === 12) return en ? 'small.en' : 'small'
  if (header.nAudioLayer === 24 && header.nTextLayer === 24) return en ? 'medium.en' : 'medium'
  if (header.nAudioLayer === 32 && header.nTextLayer === 4 && header.nMels === 128) return 'large.v3.turbo'
  if (header.nAudioLayer === 32 && header.nTextLayer === 32) {
    if (header.nMels === 128) return 'large.v3'
    return basename(file).toLowerCase().includes('v1') ? 'large.v1' : 'large.v2'
  }
  return null
}

export function modelDir(): string {
  const dir = join(dataDir(), 'models', 'whisper')
  mkdirSync(dir, { recursive: true })
  return dir
}

const modelPath = (): string => join(modelDir(), MODEL.file)

function builtinCliPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'whisper', 'whisper-cli.exe') : join(app.getAppPath(), 'resources', 'whisper', 'whisper-cli.exe')
}

function activeCli(): { source: 'builtin' | 'custom'; path: string } {
  const custom = getSettings().whisperCliPath
  if (custom && existsSync(custom)) return { source: 'custom', path: custom }
  return { source: 'builtin', path: builtinCliPath() }
}

function cliPath(): string {
  return activeCli().path
}

let download: { ctrl: AbortController; received: number; phase: 'downloading' | 'verifying' } | null = null
let lastError: string | null = null

export function whisperStatus(): WhisperStatus {
  const cli = activeCli()
  const cliFields = { cliSource: cli.source, cliPath: existsSync(cli.path) ? cli.path : null }
  if (download) {
    return {
      state: download.phase,
      received: download.received,
      total: MODEL.bytes,
      error: null,
      source: 'builtin',
      modelPath: modelPath(),
      modelName: MODEL.file,
      ...cliFields
    }
  }
  const custom = getSettings().whisperModelPath
  if (custom) {
    try {
      const stat = existsSync(custom) ? statSync(custom) : null
      if (stat?.isFile() && stat.size >= MIN_MODEL_BYTES && readGgmlHeader(custom)) {
        return {
          state: 'ready',
          received: stat.size,
          total: stat.size,
          error: null,
          source: 'custom',
          modelPath: custom,
          modelName: basename(custom),
          ...cliFields
        }
      }
    } catch {
      // Handled below as missing custom model.
    }
    return {
      state: 'missing',
      received: 0,
      total: MODEL.bytes,
      error: 'File model Whisper yang dipilih tidak ditemukan lagi atau tidak valid. Pilih ulang file atau lepas untuk memakai model bawaan.',
      source: 'custom',
      modelPath: custom,
      modelName: basename(custom),
      ...cliFields
    }
  }
  const ready = existsSync(modelPath()) && statSync(modelPath()).size === MODEL.bytes
  const part = `${modelPath()}.part`
  return {
    state: ready ? 'ready' : 'missing',
    received: ready ? MODEL.bytes : existsSync(part) ? statSync(part).size : 0,
    total: MODEL.bytes,
    error: ready ? null : lastError,
    source: ready ? 'builtin' : null,
    modelPath: ready ? modelPath() : null,
    modelName: ready ? MODEL.file : null,
    ...cliFields
  }
}

export const whisperReady = (): boolean => whisperStatus().state === 'ready' && existsSync(cliPath())

/** Verifies and saves a custom whisper-cli executable (e.g. a CUDA or Vulkan GPU build). */
export async function setCustomCli(file: string): Promise<WhisperStatus> {
  const trimmed = file.trim()
  if (!trimmed || !existsSync(trimmed) || !statSync(trimmed).isFile()) {
    throw new Error('File whisper-cli tidak ditemukan.')
  }
  const ok = await new Promise<boolean>((resolve) => {
    execFile(trimmed, ['--help'], { timeout: 5000, windowsHide: true }, (_err, stdout, stderr) => {
      const out = `${stdout ?? ''}\n${stderr ?? ''}`
      resolve(/--model|-m FNAME/i.test(out) && /--dtw|-dtw/i.test(out))
    })
  })
  if (!ok) {
    throw new Error('File yang dipilih bukan biner whisper-cli (whisper.cpp) yang kompatibel.')
  }
  setSettings({ whisperCliPath: trimmed })
  const status = whisperStatus()
  emit.whisper(status)
  return status
}

export function clearCustomCli(): WhisperStatus {
  setSettings({ whisperCliPath: null })
  const status = whisperStatus()
  emit.whisper(status)
  return status
}

/** Registers an existing GGML `.bin` model file on disk without copying or moving it. */
export function setCustomModel(file: string): WhisperStatus {
  const trimmed = file.trim()
  if (!trimmed || !existsSync(trimmed)) throw new Error('File model Whisper tidak ditemukan.')
  const stat = statSync(trimmed)
  if (!stat.isFile() || stat.size < MIN_MODEL_BYTES) {
    throw new Error('File terlalu kecil untuk menjadi model Whisper yang valid.')
  }
  if (!readGgmlHeader(trimmed)) {
    throw new Error(
      'File bukan model Whisper GGML (whisper.cpp) yang valid. Pilih file .bin berformat ggml (misalnya ggml-small.bin, ggml-base.bin, atau ggml-large-v3-turbo.bin).'
    )
  }
  cancelDownload()
  setSettings({ whisperModelPath: trimmed })
  lastError = null
  const status = whisperStatus()
  emit.whisper(status)
  return status
}

/** Unlinks the custom model path without deleting the user's file on disk. */
export function clearCustomModel(): WhisperStatus {
  setSettings({ whisperModelPath: null })
  lastError = null
  const status = whisperStatus()
  emit.whisper(status)
  return status
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Downloads the model, resuming a partial file, and checks it against the published SHA-256. */
export async function downloadModel(): Promise<void> {
  if (download) return
  if (getSettings().whisperModelPath) setSettings({ whisperModelPath: null })
  if (whisperReady()) {
    emit.whisper(whisperStatus())
    return
  }
  const part = `${modelPath()}.part`
  const ctrl = new AbortController()
  download = { ctrl, received: existsSync(part) ? statSync(part).size : 0, phase: 'downloading' }
  lastError = null
  let lastEmit = 0
  const report = (force = false): void => {
    if (force || Date.now() - lastEmit > 250) {
      lastEmit = Date.now()
      emit.whisper(whisperStatus())
    }
  }
  report(true)
  try {
    if (download.received < MODEL.bytes) {
      const have = download.received
      // Development builds can fetch from a local copy (STUDIO_WHISPER_URL) to test resuming.
      const url = (!app.isPackaged && process.env.STUDIO_WHISPER_URL) || MODEL.url
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctrl.signal })
      if (!res.ok || !res.body) throw new Error(`Unduhan gagal (HTTP ${res.status})`)
      const resumed = res.status === 206
      if (!resumed) download.received = 0
      const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (!out.write(chunk)) await once(out, 'drain')
          download.received += chunk.length
          report()
        }
      } finally {
        out.end()
        await once(out, 'close')
      }
    }
    download.phase = 'verifying'
    report(true)
    if ((await sha256(part)) !== MODEL.sha256) {
      rmSync(part, { force: true })
      throw new Error('File model rusak atau tidak lengkap. Coba unduh lagi.')
    }
    renameSync(part, modelPath())
  } catch (e) {
    lastError = ctrl.signal.aborted ? null : ((e as Error).message ?? String(e))
    if (!ctrl.signal.aborted) throw e
  } finally {
    download = null
    emit.whisper(whisperStatus())
  }
}

export function cancelDownload(): void {
  download?.ctrl.abort()
}

export function removeModel(): void {
  cancelDownload()
  rmSync(modelPath(), { force: true })
  rmSync(`${modelPath()}.part`, { force: true })
  lastError = null
  emit.whisper(whisperStatus())
}

export function openModelFolder(): void {
  const status = whisperStatus()
  if (status.source === 'custom' && status.modelPath && existsSync(status.modelPath)) {
    shell.showItemInFolder(status.modelPath)
    return
  }
  void shell.openPath(modelDir())
}

/** Whisper's language codes differ from ours only for Javanese. */
const whisperLanguage = (code: string): string => (code === 'jv' ? 'jw' : code)

function run(file: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, _out, stderr) => {
      if (signal?.aborted) return reject(new Error('Dibatalkan'))
      if (err) return reject(new Error(`Whisper gagal: ${String(stderr).trim().split('\n').slice(-3).join(' ')}`))
      resolve()
    })
    signal?.addEventListener('abort', () => p.kill('SIGKILL'), { once: true })
  })
}

type Token = { text: string; t_dtw?: number }
type JsonSegment = { text: string; offsets: { from: number; to: number }; tokens?: Token[] }

/**
 * Word-level recognition of an audio file (any format FFmpeg reads). Times are in seconds.
 * Word starts come from DTW token alignment, which follows the voice far closer than whisper's own
 * segment times. No prompt is given: a prompt that repeats the script can make Whisper loop on a
 * phrase ("tidak tidak tidak ..."), and the captions take their spelling from the script anyway.
 */
export async function recognize(audio: string, language: string, tmp: string, signal?: AbortSignal): Promise<Heard[]> {
  const status = whisperStatus()
  if (status.state !== 'ready' || !status.modelPath || !existsSync(cliPath())) {
    throw new Error('Model Whisper belum siap. Unduh atau pilih file model di Pengaturan.')
  }
  mkdirSync(tmp, { recursive: true })
  const wav = join(tmp, `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`)
  await run(binPath(ffmpegStatic!), ['-hide_banner', '-y', '-i', audio, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], signal)
  const outBase = wav.replace(/\.wav$/, '')
  const threads = String(Math.max(2, Math.min(8, Math.floor(cpus().length / 2))))
  const header = readGgmlHeader(status.modelPath)
  const dtw = header ? detectDtwPreset(status.modelPath, header) : null
  // One word per segment (-ml 1 -sow), full JSON with DTW token times when the model preset is known (DTW needs flash attention off).
  const args = ['-m', status.modelPath, '-f', wav, '-l', whisperLanguage(language), '-ml', '1', '-sow', '-ojf', '-of', outBase, '-np', '-t', threads]
  if (dtw) args.push('-nfa', '-dtw', dtw)
  await run(cliPath(), args, signal)
  const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as { transcription?: JsonSegment[] }
  rmSync(wav, { force: true })
  rmSync(`${outBase}.json`, { force: true })
  const words = (json.transcription ?? []).map((s) => {
    const dtw = (s.tokens ?? []).filter((t) => !t.text.startsWith('[_') && (t.t_dtw ?? -1) >= 0)
    const start = dtw.length ? dtw[0].t_dtw! / 100 : s.offsets.from / 1000
    return { text: s.text, start, end: Math.max(start, s.offsets.to / 1000) }
  })
  // Starts only move forward, and a word lasts until the next one starts at the latest.
  words.forEach((w, i) => {
    if (i > 0 && w.start < words[i - 1].start) w.start = words[i - 1].start
    w.end = Math.max(w.end, w.start)
  })
  words.forEach((w, i) => {
    const next = words[i + 1]
    if (next && next.start > w.start) w.end = Math.min(w.end, next.start)
  })
  return splitHeard(words)
}

/** Times for the script's words in an audio file: recognition, then alignment to the known text. */
export async function timeScript(audio: string, words: string[], language: string, durationSec: number, tmp: string, signal?: AbortSignal) {
  const heard = await recognize(audio, language, tmp, signal)
  return alignWords(words, heard, durationSec)
}
