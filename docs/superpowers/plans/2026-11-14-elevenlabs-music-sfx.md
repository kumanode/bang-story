# ElevenLabs Music & SFX Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengintegrasikan pembuatan musik latar (BGM) dan efek suara (SFX) langsung di Bang Story menggunakan API ElevenLabs dengan sistem otomatisasi cerdas berbasis naskah dan generator manual di timeline.

**Architecture:** Menambahkan endpoint Text-to-Sound Effects dan Music ke service ElevenLabs di proses main Node.js, perencana audio naskah berbasis LLM di `story.ts`, handler IPC aset terpadu dengan probe durasi FFmpeg, serta antarmuka UI modal preview SFX manual, batch AI Auto-SFX, dan generator BGM dengan preset durasi di Inspector & Timeline.

**Tech Stack:** Electron, Node.js, TypeScript, React 19, Tailwind CSS v4, Lucide Icons, SQLite (better-sqlite3), FFmpeg (`probeDurationMs`).

**Spec:** `docs/superpowers/specs/2026-11-14-elevenlabs-music-sfx-design.md`

## Global Constraints

- Indonesian for UI texts and error messages ("kamu", santai, jelas).
- English for code identifiers and comments.
- TypeScript strict with zero unused locals/imports (`npm run typecheck`).
- Kunci API pengguna tidak boleh dicetak ke log, file, atau dilewatkan ke renderer (`secrets.ts`).
- Aturan single-source of truth: semua perubahan tipe di `src/shared/types.ts` dan IPC di `src/shared/api.ts` harus selaras di `main`, `preload`, dan `renderer`.
- Jangan menghapus SFX bawaan gratis atau fitur impor lokal audio.
- Ekspor MP4 FFmpeg dan engine pemutaran timeline tidak boleh rusak.

## Review Focus

- Quota exhaustion (HTTP 402): harus menghasilkan pesan error ramah bahasa Indonesia tanpa merusak UI.
- Model access restriction (HTTP 403/404): pesan khusus jika akun ElevenLabs pengguna tidak memiliki akses ke endpoint musik.
- Safe Preview Lifecycle: tombol preview SFX manual tidak boleh memicu generate ulang saat tombol "Tambahkan ke Timeline" diklik.
- Protected Paid Assets: menjalankan fitur "SFX Otomatis" gratis bawaan tidak boleh menghapus SFX ElevenLabs berbayar yang ada di timeline.
- Partial Batch Resilience: kegagalan di tengah batch AI Auto-SFX tetap mempertahankan cue yang sudah sukses dibuat.

---

### Task 1: Extend ElevenLabs Service with Sound Effects and Music APIs

**Files:**
- Modify: `src/main/services/elevenlabs.ts`
- Test: `scratch/test-eleven-audio.ts` (verification script for payload & error mapping)

**Interfaces:**
- Consumes: `el<T>`, `requireSecret`, `readError` from `src/main/services/http.ts` and `src/main/secrets.ts`.
- Produces:
  - `generateSoundEffect(text: string, options?: { durationSeconds?: number; promptInfluence?: number }, signal?: AbortSignal): Promise<Buffer>`
  - `generateMusic(prompt: string, options?: { durationMs?: number; modelId?: string; forceInstrumental?: boolean }, signal?: AbortSignal): Promise<Buffer>`

- [ ] **Step 1: Write helper for raw binary audio requests from ElevenLabs**

Tambahkan fungsi pembantu `elAudio(path: string, init?: RequestInit): Promise<Buffer>` di `src/main/services/elevenlabs.ts` yang menangani header `xi-api-key`, memeriksa respons HTTP `res.ok`, memetakan status error (401, 402 kuota, 403/404 model, 429 rate limit), dan mengembalikan data biner audio sebagai `Buffer`.

- [ ] **Step 2: Implement `generateSoundEffect`**

Di `src/main/services/elevenlabs.ts`:
Panggil endpoint `POST /v1/sound-generation` dengan JSON `{ text, duration_seconds: options?.durationSeconds, prompt_influence: options?.promptInfluence }` dan kembalikan Buffer audio MP3.

- [ ] **Step 3: Implement `generateMusic`**

Di `src/main/services/elevenlabs.ts`:
Panggil endpoint `POST /v1/music` dengan JSON `{ prompt, music_length_ms: options?.durationMs ?? 60000, model_id: options?.modelId ?? 'music_v1', force_instrumental: options?.forceInstrumental ?? true }`. Jika status 404/403 (model tidak tersedia pada akun), lemparkan error ramah: *"Fitur ElevenLabs Music membutuhkan akses model musik pada akun kamu. Kamu tetap bisa memakai prompt ini di Suno/Udio atau membuat SFX."*

- [ ] **Step 4: Verify error handling and typing with typecheck**

Jalankan: `npm run typecheck:node`  
Ekspektasi: Lulus tanpa error kompilasi TypeScript.

- [ ] **Step 5: Commit changes**

```bash
git add src/main/services/elevenlabs.ts
git commit -m "feat(elevenlabs): add sound effects and music generation methods"
```

---

### Task 2: AI Smart SFX Planning in Story Engine

**Files:**
- Modify: `src/main/story.ts`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Consumes: `getProject`, `listClips`, `generateJson` / LLM client in `src/main/story.ts`.
- Produces:
  - `SmartSfxCue`: `{ clipId: string; timeOffsetSec: number; name: string; prompt: string; durationSec: number; volumeDb: number }`
  - `planSmartSfx(projectId: string): Promise<SmartSfxCue[]>`

- [ ] **Step 1: Define `SmartSfxCue` in `src/shared/types.ts`**

Tambahkan interface `SmartSfxCue`:
```ts
export interface SmartSfxCue {
  clipId: string
  timeOffsetSec: number
  name: string
  prompt: string
  durationSec: number
  volumeDb: number
}
```

- [ ] **Step 2: Implement `planSmartSfx` in `src/main/story.ts`**

Implementasikan fungsi `planSmartSfx(projectId: string): Promise<SmartSfxCue[]>`:
1. Ambil proyek dan daftar klip berurutan.
2. Susun prompt untuk LLM (Gemini atau penyedia aktif):
   - Minta LLM membaca narasi dan deskripsi visual setiap adegan.
   - Pilih 3 hingga 5 momen paling dramatis atau atmosferik (misal: guntur, hentakan pintu, desau angin, bunyi gelas pecah).
   - Buat `name` ringkas bahasa Indonesia (misal: "Pintu Berderit"), `prompt` bahasa Inggris deskriptif sinematik untuk ElevenLabs Sound Effects, `timeOffsetSec` (di dalam durasi klip), `durationSec` (1.0 - 5.0), dan `volumeDb` (-12 s/d -6).
3. Panggil LLM dengan skema JSON dan validasi hasilnya agar tidak melebihi durasi klip.

- [ ] **Step 3: Verify TypeScript compilation**

Jalankan: `npm run typecheck:node`  
Ekspektasi: Lulus tanpa error kompilasi.

- [ ] **Step 4: Commit changes**

```bash
git add src/shared/types.ts src/main/story.ts
git commit -m "feat(story): implement LLM-based smart SFX planning"
```

---

### Task 3: IPC Channels, Preload Bridge, and Asset Persistence

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `generateSoundEffect`, `generateMusic` from `src/main/services/elevenlabs.ts`, `planSmartSfx` from `src/main/story.ts`, `insertAsset`, `assetAbsPath`, `probeDurationMs` in `src/main/`.
- Produces IPC APIs:
  - `window.api.assets.generateSfx(projectId: string, req: { prompt: string; durationSec: number; name: string }): Promise<Asset>`
  - `window.api.story.planSmartSfx(projectId: string): Promise<SmartSfxCue[]>`
  - `window.api.story.generateMusic(projectId: string, req: { prompt: string; durationMs: number }): Promise<Asset>`

- [ ] **Step 1: Declare IPC types in `src/shared/api.ts`**

Tambahkan method di `IpcApi`:
- Di namespace `assets`: `generateSfx(projectId: string, req: { prompt: string; durationSec: number; name: string }): Promise<Asset>`
- Di namespace `story`: `planSmartSfx(projectId: string): Promise<SmartSfxCue[]>`
- Di namespace `story`: `generateMusic(projectId: string, req: { prompt: string; durationMs: number }): Promise<Asset>`

- [ ] **Step 2: Add bridge functions in `src/preload/index.ts`**

Hubungkan:
- `assets.generateSfx: call('assets:generateSfx')`
- `story.planSmartSfx: call('story:planSmartSfx')`
- `story.generateMusic: call('story:generateMusic')`

- [ ] **Step 3: Implement IPC handlers in `src/main/ipc.ts`**

1. `assets:generateSfx`:
   - Ambil buffer via `eleven.generateSoundEffect(req.prompt, { durationSeconds: req.durationSec })`.
   - Simpan buffer ke path `assets/{projectId}/sfx/{uuid}.mp3`.
   - Dapatkan durasi aktual via `probeDurationMs(abs)`.
   - Simpan asset ke SQLite via `insertAsset({ projectId, kind: 'sfx', provider: 'elevenlabs', prompt: req.prompt, localPath: rel, durationMs })`.
   - Panggil `emit.asset(asset)` dan kembalikan `asset`.
2. `story:planSmartSfx`:
   - Panggil `planSmartSfx(projectId)`.
3. `story:generateMusic`:
   - Ambil buffer via `eleven.generateMusic(req.prompt, { durationMs: req.durationMs })`.
   - Simpan buffer ke path `assets/{projectId}/music/{uuid}.mp3`.
   - Dapatkan durasi aktual via `probeDurationMs(abs)`.
   - Simpan asset ke SQLite via `insertAsset({ projectId, kind: 'music', provider: 'elevenlabs', prompt: req.prompt, localPath: rel, durationMs })`.
   - Update project editor: `musicAssetId = asset.id`, `musicStartMs = 0`, `musicDuck = true`.
   - Panggil `emit.asset(asset)` dan kembalikan `asset`.

- [ ] **Step 4: Verify typecheck on both node and web targets**

Jalankan: `npm run typecheck`  
Ekspektasi: Kedua target (`tsconfig.node.json` dan `tsconfig.web.json`) bersih tanpa error.

- [ ] **Step 5: Commit changes**

```bash
git add src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(ipc): add IPC endpoints for ElevenLabs SFX and Music generation"
```

---

### Task 4: Timeline Protection for Paid ElevenLabs SFX

**Files:**
- Modify: `src/renderer/src/pages/project/editor/Timeline.tsx`

**Interfaces:**
- Consumes: `assets` state in `useProject`, `editor.sfx` list.
- Produces: Auto-SFX cleanup logic that preserves non-builtin assets.

- [ ] **Step 1: Update auto-SFX replacement logic in `Timeline.tsx`**

Di fungsi `runAutoSfx` pada `src/renderer/src/pages/project/editor/Timeline.tsx`:
Ubah baris penyaringan:
```ts
// Sebelumnya:
const manual = (useProject.getState().project?.editor.sfx ?? []).filter((s) => !s.auto)
// Ganti menjadi:
const assets = useProject.getState().assets
const manual = (useProject.getState().project?.editor.sfx ?? []).filter((s) => {
  if (!s.auto) return true
  const asset = assets[s.assetId]
  // Jangan hapus SFX yang dihasilkan oleh ElevenLabs atau diimpor lokal!
  return asset && asset.provider !== 'builtin'
})
```

- [ ] **Step 2: Verify typecheck**

Jalankan: `npm run typecheck:web`  
Ekspektasi: Lulus tanpa error.

- [ ] **Step 3: Commit changes**

```bash
git add src/renderer/src/pages/project/editor/Timeline.tsx
git commit -m "fix(timeline): protect paid ElevenLabs SFX from being wiped by builtin auto-sfx"
```

---

### Task 5: UI Generator Musik Latar di Inspector

**Files:**
- Modify: `src/renderer/src/pages/project/editor/Inspector.tsx`

**Interfaces:**
- Consumes: `window.api.story.generateMusic`, `project.editor.musicPrompt`, `useProject`, `useApp`.
- Produces: In-app ElevenLabs Music Generation card with preset duration and loading state.

- [ ] **Step 1: Add Duration Preset State & Generator Card in `MusicPromptSection`**

Di `MusicPromptSection` (`src/renderer/src/pages/project/editor/Inspector.tsx`):
1. Tambahkan state `durationSec` dengan pilihan preset 30s, 60s (default), atau 120s.
2. Tambahkan tombol utama beraksen:
   - Ikon `Sparkles` / `Music`.
   - Teks: "Generate Musik Latar (ElevenLabs)".
   - Tampilan badge durasi terpilih.
3. Saat diklik:
   - Aktifkan status `busy`.
   - Panggil `window.api.story.generateMusic(project.id, { prompt: mp.description || mp.style, durationMs: durationSec * 1000 })`.
   - Tampilkan toast sukses: *"Musik latar berhasil dibuat dan dipasang di timeline."*
   - Tangani error dengan pesan ramah (termasuk deteksi pesan izin model).

- [ ] **Step 2: Verify UI and compile check**

Jalankan: `npm run typecheck:web`  
Ekspektasi: Lulus tanpa error.

- [ ] **Step 3: Commit changes**

```bash
git add src/renderer/src/pages/project/editor/Inspector.tsx
git commit -m "feat(inspector): add ElevenLabs background music generator card"
```

---

### Task 6: UI Modal SFX Manual & Modal AI Auto-SFX

**Files:**
- Create: `src/renderer/src/pages/project/editor/CustomSfxModal.tsx`
- Create: `src/renderer/src/pages/project/editor/SmartSfxModal.tsx`
- Modify: `src/renderer/src/pages/project/editor/Timeline.tsx`

**Interfaces:**
- Consumes:
  - `window.api.assets.generateSfx`
  - `window.api.story.planSmartSfx`
  - `window.api.story.musicPrompt`
  - Timeline state (`currentTime`, `addSfxItem`)
- Produces:
  - `CustomSfxModal`: Modal pembuatan SFX prompt manual dengan preview audio instan tanpa duplikasi kuota.
  - `SmartSfxModal`: Modal pemilihan cue dan eksekusi batch AI Auto-SFX dari naskah.

- [ ] **Step 1: Create `CustomSfxModal.tsx`**

Buat komponen `CustomSfxModal`:
1. Input teks deskripsi efek suara (placeholder: *"Contoh: Heavy wooden door slamming shut with echo"*).
2. Input / Slider durasi (rentang 0.5 – 10 detik, default 2.5s).
3. Tombol "Buat & Dengarkan":
   - Memanggil `window.api.assets.generateSfx`.
   - Memutar audio hasil respon secara instan pada pemutar internal (`<audio>` tag).
   - Menyimpan objek `Asset` yang dihasilkan ke state lokal modal.
4. Tombol "Tambahkan ke Timeline":
   - Memasukkan aset yang sudah di-generate tersebut ke timeline pada posisi `currentTime` (playhead) tanpa memanggil API ulang.
   - Menutup modal dan memunculkan toast konfirmasi.

- [ ] **Step 2: Create `SmartSfxModal.tsx`**

Buat komponen `SmartSfxModal`:
1. Saat dibuka, memanggil `window.api.story.planSmartSfx(projectId)` dan menampilkan indikator loading analisis cerita.
2. Menampilkan daftar cue dalam bentuk checklist interaktif:
   - Nama efek (bahasa Indonesia).
   - Prompt suara (bahasa Inggris).
   - Waktu kemunculan di video.
   - Durasi (detik).
3. Tombol "Generate Terpilih":
   - Menjalankan iterasi satu per satu untuk cue yang dicentang.
   - Menampilkan status progres interaktif (*"Men-generate 2 dari 4..."*).
   - Menyimpan setiap aset yang berhasil dan langsung memasangnya ke timeline.
   - Jika satu item gagal, lanjutkan ke item berikutnya dan berikan laporan di akhir (*"3 efek berhasil dipasang, 1 efek gagal"*).

- [ ] **Step 3: Integrate Modals into `Timeline.tsx`**

Di header track SFX pada `src/renderer/src/pages/project/editor/Timeline.tsx`:
1. Sempurnakan menu popover pada tombol `+`:
   - Item 1: "SFX Bawaan (Gratis)" -> sub-menu / daftar 7 suara lokal.
   - Item 2: "AI Auto-SFX Cerita (ElevenLabs)" -> membuka `SmartSfxModal`.
   - Item 3: "Buat SFX Kustom (ElevenLabs)" -> membuka `CustomSfxModal`.
   - Item 4: "Pilih file lokal..." -> pemilih file audio komputer.
2. Render kedua modal di level `Timeline.tsx` dengan kendali state `activeModal`.

- [ ] **Step 4: Verify typecheck & build**

Jalankan: `npm run typecheck`  
Jalankan: `npm run build`  
Ekspektasi: Build dan kompilasi sukses tanpa error di main, preload, dan renderer.

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/src/pages/project/editor/CustomSfxModal.tsx src/renderer/src/pages/project/editor/SmartSfxModal.tsx src/renderer/src/pages/project/editor/Timeline.tsx
git commit -m "feat(timeline): integrate manual SFX and smart AI SFX modals"
```

---

### Task 7: Final Verification and Code Review

**Files:**
- Touch all modified files to ensure code cleanups.

- [ ] **Step 1: Run comprehensive typecheck**

Jalankan: `npm run typecheck`  
Ekspektasi: Bersih tanpa error atau unused imports.

- [ ] **Step 2: Run full build**

Jalankan: `npm run build`  
Ekspektasi: Berhasil menghasilkan output bundling di folder `out/`.

- [ ] **Step 3: Commit any final polishing**

```bash
git commit -m "chore: polish ElevenLabs music and SFX integration" --allow-empty
```
