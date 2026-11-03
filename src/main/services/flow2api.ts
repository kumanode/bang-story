import { NO_MUSIC } from '@shared/higgsfield'
import { extractMediaUrls, normalizeMediaUrl } from '@shared/flow2api-catalog'
import type { KeyTestResult } from '@shared/types'
import { getSecret } from '../secrets'
import { getSettings } from '../settings'
import { ApiError, readError, sleep } from './http'

function getBaseUrl(override?: string): string {
  const base = (override ?? getSettings().flow2apiBaseUrl).trim().replace(/\/+$/, '')
  return base || 'http://localhost:8000/v1'
}

function getAuthHeader(cred?: string): Record<string, string> {
  const key = cred !== undefined ? cred : getSecret('flow2api')
  return key?.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}
}

function friendlyError(e: unknown, baseUrl: string): ApiError {
  if (e instanceof ApiError) return e
  const err = e as Error
  const msg = err.message || String(e)

  if (/ECONNREFUSED|connect ECONNREFUSED/i.test(msg)) {
    return new ApiError(
      `Tidak bisa terhubung ke Flow2API di ${baseUrl}. Pastikan server Flow2API sudah dijalankan (misal lewat Docker).`,
      503,
      true
    )
  }
  if (/AbortError|Dibatalkan/i.test(err.name) || /aborted/i.test(msg)) {
    return new ApiError('Permintaan dibatalkan', 499)
  }
  if (/ETIMEDOUT|timeout/i.test(msg)) {
    return new ApiError('Flow2API terlalu lama merespons (timeout). Coba lagi nanti.', 408, true)
  }
  return new ApiError(`Flow2API gagal: ${msg}`, 500)
}

function parseHttpError(status: number, detail: string): ApiError {
  if (status === 401) {
    return new ApiError('Token Flow2API tidak valid atau ditolak. Periksa API key di Pengaturan.', 401)
  }
  if (status === 429) {
    return new ApiError('Flow2API sedang membatasi permintaan (rate limit). Tunggu sebentar lalu coba lagi.', 429, true)
  }
  if (/cookie|session|login|unauthorized|google/i.test(detail)) {
    return new ApiError('Sesi akun Google di Flow2API kedaluwarsa. Perbarui cookie di dashboard Flow2API.', status)
  }
  if (/captcha|recaptcha/i.test(detail)) {
    return new ApiError('Verifikasi captcha gagal di Flow2API. Periksa solver captcha di dashboard Flow2API.', status)
  }
  if (/safety|moderation|block|policy/i.test(detail)) {
    return new ApiError('Prompt ditolak oleh kebijakan keamanan Google Flow. Ubah prompt lalu coba lagi.', status)
  }
  if (/不支持的模型|unsupported model|unknown model/i.test(detail)) {
    return new ApiError(
      `Model tidak dikenali oleh Flow2API (${detail}). Pilih model lain di Pengaturan atau perbarui Flow2API.`,
      status
    )
  }
  if (/没有可用的Token|no available token|token.*(expired|cooldown|disabled|locked|tidak ada)/i.test(detail)) {
    return new ApiError(
      'Tidak ada token/akun Google yang aktif di Flow2API (semua token nonaktif, cooldown, atau kedaluwarsa). Buka dashboard Flow2API untuk menambahkan atau memperbarui akun Google kamu.',
      status
    )
  }
  if (/额度|quota|insufficient/i.test(detail)) {
    return new ApiError('Kuota akun di Flow2API telah habis. Tambahkan akun Google baru di dashboard Flow2API.', status)
  }
  if (status >= 500) {
    return new ApiError(`Server Flow2API mengalami kesalahan (${status}): ${detail}`, status, true)
  }
  return new ApiError(`Flow2API menolak permintaan (${status}): ${detail}`, status)
}

/**
 * Tests connection to Flow2API by requesting the model list.
 */
export async function testCredentials(key?: string, baseUrlOverride?: string): Promise<KeyTestResult> {
  const base = getBaseUrl(baseUrlOverride)
  try {
    const url = `${base}/models`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...getAuthHeader(key)
      }
    })

    if (!res.ok) {
      const detail = await readError(res)
      throw parseHttpError(res.status, detail)
    }

    const data = (await res.json()) as { data?: unknown[]; models?: unknown[] }
    const count = Array.isArray(data.data) ? data.data.length : Array.isArray(data.models) ? data.models.length : 0
    return {
      ok: true,
      message: count > 0 ? `Terhubung · ${count} model aktif di Flow2API` : 'Terhubung ke server Flow2API'
    }
  } catch (e) {
    const fe = friendlyError(e, base)
    return { ok: false, message: fe.message }
  }
}

/**
 * Handles streaming response from Flow2API, accumulating markdown chunks and emitting progress.
 */
async function streamCompletion(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (fraction: number, message: string) => void,
  progressLabel = 'Memproses di Flow2API'
): Promise<string> {
  const base = getBaseUrl()
  const url = `${base}/chat/completions`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(body),
      signal
    })
  } catch (e) {
    throw friendlyError(e, base)
  }

  if (!res.ok) {
    const detail = await readError(res)
    throw parseHttpError(res.status, detail)
  }

  if (!res.body) {
    throw new Error('Flow2API tidak mengembalikan konten respons')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let accumulatedText = ''
  let buffer = ''
  // Flow2API reports progress and failure text in reasoning_content; kept so an empty result can say why.
  let lastStatus = ''
  const started = Date.now()

  // Flow2API answers 200 and then streams `data: {"error": {...}}`, so failures only show up here.
  const readChunk = (jsonStr: string): void => {
    let parsed: {
      error?: { message?: string; status_code?: number }
      choices?: Array<{ delta?: { content?: string; text?: string; reasoning_content?: string } }>
    }
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      return
    }
    if (parsed.error) {
      throw parseHttpError(parsed.error.status_code ?? 500, parsed.error.message || 'Generation failed')
    }
    const delta = parsed.choices?.[0]?.delta
    const content = delta?.content ?? delta?.text ?? ''
    if (content) accumulatedText += content
    const status = delta?.reasoning_content?.trim()
    if (status) lastStatus = status
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      const elapsed = Date.now() - started
      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk

      // Update progress based on elapsed time (smooth asymptote towards 92%)
      const progress = 0.15 + 0.77 * (1 - Math.exp(-elapsed / 50_000))
      onProgress?.(progress, progressLabel)

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (trimmed === 'data: [DONE]') continue

        if (trimmed.startsWith('data: ')) readChunk(trimmed.slice(6).trim())
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Handle any remaining buffered content or non-streaming JSON responses
  const remaining = buffer.trim()
  if (remaining) {
    if (remaining.startsWith('data: ') && remaining !== 'data: [DONE]') {
      readChunk(remaining.slice(6).trim())
    } else if (!accumulatedText) {
      try {
        const parsed = JSON.parse(remaining)
        if (parsed.error) throw parseHttpError(parsed.error.status_code ?? 500, parsed.error.message || 'Generation failed')
        const content =
          parsed.choices?.[0]?.message?.content ??
          parsed.choices?.[0]?.delta?.content ??
          parsed.choices?.[0]?.text ??
          ''
        if (content) accumulatedText = content
      } catch (e) {
        if (e instanceof ApiError) throw e
      }
    }
  }

  return accumulatedText || lastStatus
}

/**
 * Executes streamCompletion with automatic retry and backoff for transient network and server errors.
 */
async function streamCompletionWithRetry(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (fraction: number, message: string) => void,
  progressLabel = 'Memproses di Flow2API'
): Promise<string> {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await streamCompletion(body, signal, onProgress, progressLabel)
    } catch (e) {
      if (signal?.aborted) throw e
      const isRetryable = e instanceof ApiError && e.retryable
      if (attempt < maxAttempts && isRetryable) {
        const delayMs = attempt * 3000
        onProgress?.(0.05, `Koneksi Flow2API terputus atau sibuk. Mencoba ulang (${attempt}/${maxAttempts - 1})...`)
        await sleep(delayMs, signal)
        continue
      }
      throw e
    }
  }
  throw new Error('Flow2API gagal setelah beberapa kali mencoba')
}

export interface GenerateImageOptions {
  prompt: string
  model: string
  referenceImages?: Buffer[]
  signal?: AbortSignal
  onProgress?: (fraction: number, message: string) => void
}

/**
 * Generates an image using Flow2API (Nano Banana / Imagen models).
 */
export async function generateImage(opts: GenerateImageOptions): Promise<{ mediaUrl: string }> {
  const base = getBaseUrl()
  const contentItems: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    { type: 'text', text: opts.prompt }
  ]

  if (opts.referenceImages?.length) {
    for (const ref of opts.referenceImages.slice(0, 3)) {
      contentItems.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${ref.toString('base64')}` }
      })
    }
  }

  const body = {
    model: opts.model,
    messages: [
      {
        role: 'user',
        content: contentItems.length === 1 ? opts.prompt : contentItems
      }
    ],
    stream: true
  }

  opts.onProgress?.(0.08, 'Mengirim ke Flow2API')
  const markdown = await streamCompletionWithRetry(body, opts.signal, opts.onProgress, 'Membuat gambar di Flow2API')

  const urls = extractMediaUrls(markdown)
  if (!urls.length) {
    throw new Error('Flow2API selesai tanpa mengembalikan tautan gambar hasil')
  }

  return { mediaUrl: normalizeMediaUrl(urls[0], base) }
}

export interface GenerateVideoOptions {
  prompt: string
  model: string
  aspectRatio: '16:9' | '9:16'
  durationSec: number
  /** Omitted for text-to-video models. */
  initialImage?: Buffer
  signal?: AbortSignal
  onProgress?: (fraction: number, message: string) => void
}

/**
 * Generates an AI video from a clip's initial image using Flow2API (Veo models).
 */
export async function generateVideo(opts: GenerateVideoOptions): Promise<{ mediaUrl: string }> {
  const base = getBaseUrl()
  const cleanPrompt = `${opts.prompt.trim()} ${NO_MUSIC}`

  const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    { type: 'text', text: cleanPrompt }
  ]
  if (opts.initialImage) {
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${opts.initialImage.toString('base64')}` } })
  }

  const body = {
    model: opts.model,
    messages: [{ role: 'user', content }],
    // Flow2API's resolver reads orientation and duration from here to pick the internal Veo model.
    generationConfig: { aspectRatio: opts.aspectRatio, durationSeconds: opts.durationSec },
    stream: true
  }

  opts.onProgress?.(0.08, 'Mengirim ke Flow2API')
  const markdown = await streamCompletionWithRetry(body, opts.signal, opts.onProgress, 'Membuat video di Flow2API (Google Veo)')

  const urls = extractMediaUrls(markdown)
  if (!urls.length) {
    const reason = markdown.trim().slice(0, 300)
    throw new Error(`Flow2API selesai tanpa mengembalikan tautan video hasil${reason ? `: ${reason}` : ''}`)
  }

  // Pick first mp4 if available, or first media url
  const videoUrl = urls.find((u) => /\.mp4(\?|$)/i.test(u)) ?? urls[0]
  return { mediaUrl: normalizeMediaUrl(videoUrl, base) }
}
