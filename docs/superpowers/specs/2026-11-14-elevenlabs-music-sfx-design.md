# Desain Teknis: Integrasi ElevenLabs untuk Backsound & SFX (Hybrid Smart-Automation)

**Tanggal:** 2026-11-14  
**Topik:** Peningkatan Backsound (Musik Latar) dan Sound Effects (SFX) menggunakan API ElevenLabs di Bang Story.  
**Pendekatan Terpilih:** Opsi 2 — *Hybrid Smart-Automation* (Otomatisasi Cerdas Berbasis Cerita + Generator Manual di Timeline).

---

## 1. Latar Belakang & Tujuan (Intent & The Why)

Saat ini, Bang Story sudah memiliki alur produksi video YouTube yang terotomatisasi (ide → naskah → visual storyboard → narasi suara → timeline editor → ekspor video). Namun di aspek audio sekunder:
1. **SFX (Sound Effects):** Hanya menyediakan 7 file audio lokal bawaan (`whoosh`, `boom`, `riser`, `knock`, `thunder`, `bell`, `glitch`) yang dicocokkan dengan beberapa kata kunci naskah sederhana (`planAutoSfx`). Efek suara adegan spesifik (misal suara tapak kaki di salju, desau angin badai, gemerincing kunci, suara tembakan laser) tidak bisa dibuat.
2. **Backsound (Musik Latar):** Hanya membuatkan teks prompt (`MusicPrompt`) lalu mengarahkan pengguna membuka tab browser ke Suno, Udio, atau ElevenLabs Music untuk mengunduh audio manual secara eksternal.

Pengguna sudah memiliki akun dan API Key ElevenLabs yang tersimpan di aplikasi (sebelumnya digunakan untuk TTS suara narator). ElevenLabs menyediakan endpoint resmi:
- **Text-to-Sound Effects API** (`POST /v1/sound-generation`): Menghasilkan efek suara orisinal berdurasi 0.5–22 detik langsung dari teks deskripsi.
- **Music API** (`POST /v1/music`): Menghasilkan musik latar instrumental orisinal dari prompt deskripsi gaya & suasana lagu.

Tujuan dari fitur ini adalah memaksimalkan potensi ElevenLabs sehingga pengguna dapat:
1. Menghasilkan musik latar berkualitas tinggi secara instan (1-klik) langsung dari aplikasi dan otomatis terpasang di timeline video.
2. Menghasilkan SFX kustom melalui prompt manual di timeline editor.
3. Menghasilkan SFX otomatis berbasis kecerdasan buatan (AI Auto-SFX) yang menganalisis naskah dan prompt visual tiap adegan untuk menaruh efek suara kontekstual di momen dramatis.
4. Tetap memiliki kendali penuh terhadap penggunaan kuota kredit ElevenLabs dengan adanya estimasi, review cue, dan ketersediaan opsi lokal gratis.

---

## 2. Goals, Non-Goals, Anti-Goals

### Goals
- Mengimplementasikan pemanggilan API ElevenLabs untuk Text-to-Sound Effects (`/v1/sound-generation`).
- Mengimplementasikan pemanggilan API ElevenLabs untuk Music Generation (`/v1/music`).
- Menambahkan tombol generate musik latar 1-klik di tab Musik Inspector dengan status loading, durasi target otomatis, dan langsung menautkan audio ke track musik timeline.
- Menambahkan dialog/panel "Buat SFX dengan ElevenLabs" untuk memasukkan prompt SFX manual, durasi, preview suara, dan tombol pasang di playhead timeline.
- Mengembangkan perencana SFX cerdas (`planSmartSfx` via LLM) yang mendeteksi momen audio penting dalam adegan cerita, merumuskan prompt bahasa Inggris untuk ElevenLabs Sound Effects, dan menampilkan ringkasan/review sebelum dieksekusi.
- Menyimpan hasil audio secara konsisten di SQLite database sebagai `Asset` (`kind: 'sfx'` atau `'music'`, `provider: 'elevenlabs'`) dan file audio MP3 lokal di folder proyek.
- Menyajikan pesan error yang ramah pengguna dalam bahasa Indonesia (kuota habis, model tidak didukung tier langganan, jaringan putus).

### Non-Goals
- Tidak menggantikan SFX bawaan (7 SFX lokal tetap tersedia sebagai alternatif gratis tanpa kuota).
- Tidak menghapus opsi impor file audio manual dari komputer (pengguna tetap bebas memakai file MP3/WAV milik sendiri).
- Tidak mengubah mesin pemutaran audio (`engine.ts`) atau modul ekspor FFmpeg (`exporter.ts`) karena arsitektur timeline dan track SFX/Musik yang ada saat ini sudah mendukung multi-SFX dan musik dengan ducking/volume.

### Anti-Goals
- **Anti-pemborosan kuota:** Jangan pernah menjalankan generate audio ElevenLabs secara diam-diam di background tanpa instruksi atau persetujuan pengguna.
- Jangan hardcode prompt bahasa Indonesia ke API ElevenLabs SFX/Music; gunakan terjemahan/optimasi prompt bahasa Inggris agar hasil audio optimal.

---

## 3. Batasan & Dependensi (Constraints)

1. **Format API ElevenLabs:**
   - Sound Generation: `POST https://api.elevenlabs.io/v1/sound-generation` dengan payload JSON `{ text, duration_seconds?, prompt_influence?, loop? }`. Response berupa binary stream audio MPEG (`audio/mpeg`).
   - Music Generation: `POST https://api.elevenlabs.io/v1/music` dengan payload JSON `{ prompt, music_length_ms?, model_id?, force_instrumental: true }`. Response berupa binary stream audio MPEG.
2. **Kunci API & Keamanan:**
   - Kunci API menggunakan penyimpan aman `secrets.ts` (provider `'elevenlabs'`). Tidak boleh bocor ke log atau renderer.
3. **Format Penyimpanan & Probe:**
   - Audio yang diterima (Buffer) disimpan ke `assets/{projectId}/sfx/...` atau `assets/{projectId}/music/...`.
   - Durasi audio diuji akurat menggunakan FFmpeg `probeDurationMs` bawaan aplikasi sebelum disimpan ke SQLite.
4. **Prinsip Single Source of Truth:**
   - Aturan tipe data di `src/shared/types.ts` dan IPC di `src/shared/api.ts` harus disinkronkan secara ketat sesuai aturan arsitektur Bang Story.

---

## 4. Pendekatan yang Dipertimbangkan (Approaches Considered)

| Pendekatan | Deskripsi | Kelebihan | Kekurangan |
|---|---|---|---|
| **Opsi 1: Studio Audio Manual** | Generate manual per kebutuhan di panel editor (ketik prompt SFX & klik generate musik). | Sangat hemat kuota, kontrol granular 100%. | Lambat; pengguna harus memikirkan dan membuat SFX satu per satu untuk puluhan adegan. |
| **Opsi 2: Hybrid Smart-Automation (Terpilih)** | 1-klik BGM otomatis dari cerita + AI Auto-SFX per adegan naskah + generator manual di timeline. | Cepat, video langsung sinematik dan hidup, namun pengguna tetap punya kontrol penuh dan review sebelum generate. | Membutuhkan implementasi perencana prompt LLM untuk SFX. |
| **Opsi 3: BGM Saja + SFX Lokal** | ElevenLabs hanya untuk BGM, SFX hanya menambah koleksi file lokal statis gratis. | Bebas kuota SFX. | Variasi efek suara terbatas, tidak bisa membuat audio spesifik imajinatif sesuai naskah unik. |

**Alasan Memilih Opsi 2:** Selaras dengan filosofi Bang Story yang mengotomatisasi pembuatan video cerita dari naskah namun tetap menyediakan ruang penyuntingan kreatif bagi pembuat konten.

---

## 5. Arsitektur & Desain Rinci

### A. Layanan Backend (`src/main/services/elevenlabs.ts`)
Tambahkan fungsi untuk memanggil endpoint suara & musik:
```ts
export async function generateSoundEffect(
  text: string,
  options?: { durationSeconds?: number; promptInfluence?: number },
  signal?: AbortSignal
): Promise<Buffer>

export async function generateMusic(
  prompt: string,
  options?: { durationMs?: number; modelId?: string; forceInstrumental?: boolean },
  signal?: AbortSignal
): Promise<Buffer>
```
Penanganan error:
- Tangani status 401 (kunci salah), 402 (kuota habis), 404 (model musik tidak tersedia di paket langganan pengguna), dan 429 (rate limit).

### B. Perencana SFX AI (`src/main/story.ts`)
Fungsi `planSmartSfx(projectId: string)`:
1. Mengambil data klip cerita (naskah narasi, visual prompt, durasi tiap adegan).
2. Meminta LLM (Gemini/penyedia aktif) menyusun daftar 3–6 momen audio paling signifikan di sepanjang video:
   ```ts
   export interface SmartSfxCue {
     clipId: string
     timeOffsetSec: number // detik relatif dari awal klip
     name: string          // Nama tampilan ID (misal: "Pintu Berderit")
     prompt: string        // Prompt deskriptif EN untuk ElevenLabs
     durationSec: number   // 1.0 - 5.0 detik
     volumeDb: number      // -12 s/d -6 dB
   }
   ```
3. Mengembalikan daftar cue ke frontend untuk ditinjau oleh pengguna.

### C. Alur Pembuatan Aset & Penyimpanan (`src/main/ipc.ts`)
1. **`assets:generateSfx`**:
   - Menerima `projectId`, `prompt`, `durationSec`, `name`.
   - Memanggil `generateSoundEffect`.
   - Menyimpan buffer ke `assets/sfx/{uuid}.mp3`.
   - Mengambil durasi via `probeDurationMs`.
   - Menyimpan ke database SQLite (`insertAsset`) dengan `kind: 'sfx'`, `provider: 'elevenlabs'`.
   - Mengirim event `emit.asset` dan mengembalikan objek `Asset`.
2. **`story:generateMusic`**:
   - Menerima `projectId`, `prompt`, `durationMs`.
   - Memanggil `generateMusic`.
   - Menyimpan buffer ke `assets/music/{uuid}.mp3`.
   - Mengambil durasi via `probeDurationMs`.
   - Menyimpan ke database SQLite (`insertAsset`) dengan `kind: 'music'`, `provider: 'elevenlabs'`.
   - Memperbarui `editor.musicAssetId = asset.id`, `musicStartMs = 0`, `musicDuck = true`.
   - Mengembalikan objek `Asset`.

### D. Tampilan Antarmuka (UI/UX)
1. **Inspector Tab Musik (`src/renderer/src/pages/project/editor/Inspector.tsx`)**:
   - Di bawah kotak `MusicPromptSection`, tambahkan kartu tindakan utama:
     - Tombol **"Generate Musik Latar (ElevenLabs)"** dengan ikon sparkles.
     - Estimasi durasi (misal 30–60 detik atau sepanjang video).
     - Indikator status progres / spinner saat proses generate berjalan.
     - Setelah selesai, track musik otomatis aktif dan audio player siap diputar.
     - Tombol eksternal "Buka Suno / Udio" tetap dipertahankan sebagai opsi alternatif.
2. **Timeline Track SFX & Tab Efek (`Timeline.tsx` & `Inspector.tsx`)**:
   - Di menu header track SFX (sebelah tombol SFX otomatis), tambahkan dropdown/menu:
     - *SFX Bawaan (Gratis)* -> daftar 7 SFX lokal.
     - *AI Auto-SFX (ElevenLabs)* -> membuka modal ringkasan cue yang dirancang AI berdasarkan naskah, lalu ada tombol "Generate Semua SFX".
     - *Ketik Prompt SFX Manual* -> modal sederhana: input deskripsi suara, slider durasi (0.5 - 10s), tombol "Dengarkan Preview", dan tombol "Tambahkan ke Timeline".

---

## 6. Penanganan Masalah & Kasus Khusus (Edge Cases)

1. **Akses Model Musik ElevenLabs:**
   - Model `music_v1` atau `music_v2` mungkin membutuhkan tier langganan tertentu pada akun ElevenLabs. Jika API mengembalikan error 404 / 403 terkait izin model, sistem akan menampilkan pesan informatif: *"Fitur ElevenLabs Music membutuhkan akses model musik pada akun kamu. Kamu tetap bisa menggunakan prompt ini di Suno/Udio atau membuat SFX."*
2. **Keterbatasan Kuota Karakter / Kredit:**
   - Sebelum generate batch SFX, aplikasi menampilkan perkiraan jumlah efek yang akan dibuat (misal: "Akan men-generate 4 efek suara").
3. **Pembatalan Permintaan (AbortSignal):**
   - Generator mendukung sinyal pembatalan jika pengguna menutup modal atau membatalkan proses saat request sedang berjalan.
4. **Ducking & Volume Balancing:**
   - Musik latar ElevenLabs otomatis mengaktifkan fitur `musicDuck: true` (volume musik otomatis mengecil saat narator berbicara) sesuai standar timeline Bang Story.

---

## 7. Rencana Pengujian & Verifikasi (Verification Plan)

1. **Typecheck & Build:**
   - `npm run typecheck` harus lulus tanpa error pada `tsconfig.node.json` dan `tsconfig.web.json`.
   - `npm run build` berhasil mengompilasi proses main, preload, dan renderer ke folder `out/`.
2. **Uji Fungsional Backend:**
   - Uji pemanggilan `generateSoundEffect` dan `generateMusic` dengan mock / parameter valid.
   - Verifikasi file tersimpan di folder aset proyek dan tercatat di database SQLite.
   - Verifikasi durasi terdeteksi dengan benar oleh FFmpeg `probeDurationMs`.
3. **Uji Antarmuka (Dev Harness & UI):**
   - Buka proyek di editor, verifikasi tombol di tab Musik dan tab SFX.
   - Verifikasi timeline menampilkan klip audio musik dan SFX dengan benar.
   - Verifikasi engine pemutar memutar audio saat playhead menyentuh SFX dan BGM.
