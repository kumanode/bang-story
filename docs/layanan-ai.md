# Layanan AI dan kunci API

Semua panggilan ke layanan luar dilakukan di **proses utama** (`src/main/services/`). Renderer tidak pernah
memegang kunci API.

## Kunci API (BYOK)

Pengguna memasukkan kuncinya sendiri di **Pengaturan › Layanan AI dan kunci**.

- Disimpan di tabel `secrets` setelah dienkripsi dengan Electron `safeStorage`. Di Windows ini memakai DPAPI,
  terikat ke akun Windows pengguna, jadi salinan `studio.db` di komputer lain tidak bisa membuka kuncinya.
- Kunci kriptonya dibuat saat startup (`warmUpEncryption`) supaya tidak hilang kalau aplikasi ditutup paksa tepat
  setelah menyimpan kunci pertama.
- `requireSecret(provider)` melempar error berbahasa Indonesia kalau kunci belum ada.
- `revealSecret` hanya dipanggil tombol "tampilkan kunci" di Pengaturan.
- **Jangan pernah** menulis kunci ke log, pesan error, file, URL, atau mengirimnya ke layanan lain.
- Mengganti kunci Higgsfield menghapus cache estimasi kredit (`forgetEstimates`).

| Penyedia (`ApiProvider`) | Dipakai untuk |
|---|---|
| `higgsfield` | gambar, lembar karakter, video |
| `gemini` | LLM (naskah/visual) dan Gemini TTS |
| `elevenlabs` | TTS |
| `openrouter`, `groq`, `custom` | LLM lewat API kompatibel OpenAI |

## LLM (`services/llm.ts`, `services/gemini.ts`)

- `generateJson({ system, prompt, schema, name })` memanggil penyedia aktif (`settings.llmProvider` +
  `llmModels[provider]`).
  - Gemini: `@google/genai` dengan `responseJsonSchema` (dan cadangan: skema ditulis di system instruction).
  - Lainnya: `/chat/completions`, dicoba berurutan `json_schema` (strict) → `json_object` → teks biasa, lalu JSON
    diambil dari teks (`extractJson`) untuk model yang tidak mendukung structured output.
- `listModels(source)`: daftar model live dari penyedia, dicache di tabel `cache` dan disegarkan saat basi.
- **Menambah penyedia LLM baru** yang kompatibel OpenAI: tambahkan ke `LlmProvider` dan `ApiProvider`
  (`types.ts`), `LLM_PROVIDERS` (`shared/models.ts`), konfigurasi base URL di `llm.ts`, dan `DEFAULT_SETTINGS.llmModels`.

## TTS

| Penyedia | File | Catatan |
|---|---|---|
| Gemini TTS | `services/gemini.ts` | PCM 24 kHz → WAV; daftar suara dari Voice Library (`listVoices`, cache 24 jam) dengan cadangan statis di `shared/models.ts`; contoh suara bawaan di `renderer/src/assets/voices` |
| ElevenLabs | `services/elevenlabs.ts` | memakai endpoint with-timestamps untuk waktu per kata; tag `<...>` diubah ke `[tag]` untuk model v3, atau ke `<break>` untuk model lama (`toElevenLabsText`) |

Narasi selalu dibuat satu rekaman utuh lalu dipotong. Lihat [alur-produksi.md](alur-produksi.md#4-narasi-srcmainnarrationts).

### Kemasan YouTube (`youtubeMetadata`)

Prompt di `story.ts` mengirim judul proyek, sinopsis, sampai 40 adegan pertama (judul dan ringkasan maksimal 120 karakter), durasi, dan bab yang disusun oleh `shared/chapters.ts`. Adegan pendek digabung sampai tiap bab berdurasi minimal 10 detik. Jika hasilnya kurang dari tiga bab, editor menampilkan peringatan karena YouTube membutuhkan minimal tiga timestamp.

## Higgsfield (`services/higgsfield.ts`, `shared/higgsfield.ts`)

- Base URL `https://api.higgsfield.ai`, header `Authorization: Key <kunci>`.
- Alur: `submit(endpoint, body)` → polling `getStatus` → unduh hasil. `uploadFile` mengunggah gambar referensi
  (lembar karakter, gambar klip untuk video).
- `estimate(endpoint, body)` memanggil `/estimate/<endpoint>` → `{ credits, usd }`, dicache 24 jam di tabel `cache`.
  Endpoint ini gratis (tidak memakai kredit). API Higgsfield tidak punya daftar harga maupun endpoint saldo, jadi
  biaya per model selalu diambil dari sini.
- Pesan error dibuat ramah (`friendly`): kunci salah, kredit habis, terlalu banyak proses, model tidak tersedia.
- Untuk pengembangan, `STUDIO_HF_BASE` bisa diarahkan ke server tiruan (mock) supaya UI bisa diuji tanpa kredit.

### Katalog model (`src/shared/higgsfield-catalog.json`)

48 model: 14 model gambar (teks ke gambar) dan 34 model video yang bisa menganimasikan gambar klip. Model yang butuh
video masukan (edit video, motion control) atau hanya teks-ke-video sengaja tidak dimasukkan. Seedream belum tersedia
di API Higgsfield (hanya di aplikasi webnya). Satu entri:

```json
{
  "id": "kling-video/v3.0/std/image-to-video",
  "name": "Kling 3.0 · Standard · Image to video",
  "family": "Kling",
  "kind": "video",
  "input": { "field": "image_url", "mode": "first-frame", "max": 1 },
  "required": ["image_url"],
  "props": { "prompt": { "type": "string" }, "duration": { "type": "integer", "minimum": 3, "maximum": 15 }, "sound": { "enum": ["on", "off"] } },
  "durations": { "min": 3, "max": 15 },
  "tags": ["Kling"]
}
```

- `input.field`/`mode`/`max`: tempat gambar referensi atau frame pertama dikirim, dan berapa banyak.
- `props`: skema parameter dari dokumentasi Higgsfield. `imageBody`/`videoBody` di `shared/higgsfield.ts`
  mengisinya secara umum: rasio, resolusi, kualitas, durasi, mematikan `enhance_prompt`, `prompt_extend`, dan audio.
- `durations`: rentang (`min`/`max`) atau daftar (`values`) durasi video.
- **Menambah model**: tambahkan entri baru dengan format yang sama dari dokumentasi API Higgsfield
  (`https://docs.higgsfield.ai/docs/llms.txt`), lalu pastikan `imageBody`/`videoBody` tidak melempar error
  "butuh <field>" (`checkRequired`). Ikon keluarga model diatur di `components/ModelLogo.tsx`.
- Model bawaan: `DEFAULT_IMAGE_MODEL` dan `DEFAULT_VIDEO_MODEL` di `shared/higgsfield.ts`.

## Whisper lokal (`src/main/whisper.ts`)

- Biner: `resources/whisper/whisper-cli.exe` + DLL (whisper.cpp, lisensi MIT). Saat ini hanya untuk Windows.
- Model: `ggml-small.bin` (sekitar 488 MB) dari Hugging Face (`ggerganov/whisper.cpp`), diunduh di Pengaturan ke
  `<folder data>\models\whisper`, bisa dijeda dan dilanjutkan (HTTP Range), lalu dicek SHA-256. Untuk pengembangan, `STUDIO_WHISPER_URL` bisa menunjuk salinan lokal.
- Dijalankan di antrean `whisper` (satu per satu). Detail argumennya di [alur-produksi.md](alur-produksi.md#5-caption-akurat-whisper-lokal).

## YouTube (halaman About)

Video tutorial diputar lewat iframe `https://www.youtube.com/embed/<id>`. Sejak 2025 YouTube mewajibkan pemutar
embed mengirim identitas lewat header HTTP Referer (tanpa itu: Error 153). Aplikasi yang memuat halaman dari
`file://` tidak mengirim Referer, jadi `identifyToYouTube()` (`src/main/index.ts`) menambahkan
`Referer: https://id.bangtutorial.bangstory/` (ID aplikasi) hanya untuk permintaan embed. Iframe tanpa
autoplay, supaya putaran dari pengguna terhitung sebagai view.

## Membuka tautan

`app:openExternal` hanya menerima URL `https://` dan membukanya di browser bawaan. Pakai ini untuk semua tautan
ke luar (dokumentasi penyedia, channel YouTube, Suno, dan lainnya).
