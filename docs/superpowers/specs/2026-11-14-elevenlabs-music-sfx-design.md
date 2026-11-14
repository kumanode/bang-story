# Desain Teknis: Integrasi ElevenLabs untuk Backsound & SFX (Hybrid Smart-Automation)

**Tanggal:** 2026-11-14  
**Topik:** Peningkatan Backsound (Musik Latar) dan Sound Effects (SFX) menggunakan API ElevenLabs di Bang Story.  
**Pendekatan Terpilih:** Opsi 2 — *Hybrid Smart-Automation* (Otomatisasi Cerdas Berbasis Cerita + Generator Manual di Timeline).  
**Status:** Menunggu Persetujuan Pengguna

---

## 1. Latar Belakang & Tujuan (Intent & The Why)

Saat ini di Bang Story:
1. **SFX (Sound Effects):** Hanya menyediakan 7 file audio lokal bawaan (`whoosh`, `boom`, `riser`, `knock`, `thunder`, `bell`, `glitch`) yang dicocokkan dengan deteksi kata kunci naskah sederhana (`planAutoSfx`). Efek suara adegan yang spesifik (misal: langkah kaki di salju, desau angin dingin, pintu berderit, suara pedang beradu) belum bisa dibuat.
2. **Backsound (Musik Latar):** Hanya menghasilkan teks prompt (`MusicPrompt`) lalu mengarahkan pengguna membuka tab browser ke Suno, Udio, atau ElevenLabs Music untuk mengunduh audio manual secara eksternal.

Pengguna telah mengonfigurasi API Key ElevenLabs yang tersimpan aman di aplikasi (sebelumnya digunakan untuk suara narator TTS). ElevenLabs menyediakan endpoint resmi:
- **Text-to-Sound Effects API** (`POST /v1/sound-generation`): Menghasilkan efek suara berkualitas tinggi (0.5–22 detik) dari teks deskripsi.
- **Music API** (`POST /v1/music`): Menghasilkan musik latar instrumental dari deskripsi gaya, tempo, dan instrumen.

Tujuan dari fitur ini adalah memaksimalkan potensi ElevenLabs sehingga pengguna dapat:
1. Menghasilkan musik latar instrumental instan di dalam aplikasi tanpa perlu pindah tab browser, dengan durasi yang efisien kuota (preset 30s/60s/120s) dan otomatis di-loop halus di timeline.
2. Menghasilkan SFX kustom melalui prompt manual di timeline editor dengan preview instan tanpa pemborosan kuota ganda.
3. Menghasilkan SFX otomatis berbasis naskah (AI Auto-SFX) yang menganalisis adegan visual & cerita untuk menaruh 3–5 efek suara penting di timeline.
4. Menjaga keamanan kredit berbayar (tidak ada pemborosan kuota diam-diam, SFX berbayar tidak tertimpa SFX gratis, dan partial success tetap disimpan).

---

## 2. Goals, Non-Goals, Anti-Goals

### Goals
- Mengintegrasikan API ElevenLabs Text-to-Sound Effects (`/v1/sound-generation`).
- Mengintegrasikan API ElevenLabs Music (`/v1/music`).
- Menambahkan generator musik latar di Inspector Tab Musik dengan preset durasi hemat kuota (30s, 60s [default], 120s), indikator loading, dan integrasi langsung ke track timeline.
- Menambahkan modal/panel pembuatan SFX manual (input prompt, slider durasi, tombol preview suara, tombol pasang di playhead).
- Menambahkan perencana SFX cerdas (`planSmartSfx` via LLM) untuk menganalisis cerita dan menyusun cue audio kontekstual beserta prompt bahasa Inggris untuk ElevenLabs.
- Menyimpan hasil audio secara konsisten di SQLite database sebagai `Asset` (`kind: 'sfx'` atau `'music'`, `provider: 'elevenlabs'`) dan file audio lokal di folder proyek.
- Memberikan feedback informatif dalam bahasa Indonesia untuk semua skenario (sukses, parsial, kuota habis, model musik tidak didukung tier).

### Non-Goals
- Tidak menghapus 7 SFX bawaan gratis maupun fitur impor audio lokal dari komputer.
- Tidak mengubah engine audio pemutar (`engine.ts`) atau modul render FFmpeg (`exporter.ts`) karena arsitektur Bang Story sudah mendukung multi-SFX, looping musik, dan audio ducking.

### Anti-Goals
- **Anti-pemborosan kuota:** Tidak ada pemanggilan API ElevenLabs tanpa konfirmasi eksplisit dari pengguna.
- **Anti-biaya ganda:** Tombol preview suara SFX tidak akan men-generate ulang saat pengguna menekan "Tambahkan ke Timeline".
- **Anti-data hilang:** SFX ElevenLabs yang sudah berhasil dibuat tidak akan terhapus jika pengguna menjalankan fitur SFX bawaan gratis di kemudian hari.

---

## 3. Batasan & Dependensi (Constraints)

1. **Format API ElevenLabs:**
   - Sound Generation: `POST https://api.elevenlabs.io/v1/sound-generation` dengan JSON `{ text, duration_seconds?, prompt_influence?, loop? }`. Response berupa binary stream audio MPEG (`audio/mpeg`).
   - Music Generation: `POST https://api.elevenlabs.io/v1/music` dengan JSON `{ prompt, music_length_ms?, model_id?, force_instrumental: true }`. Response berupa binary stream audio MPEG.
2. **Kunci API & Keamanan:**
   - Kunci API menggunakan penyimpan aman `secrets.ts` (provider `'elevenlabs'`). Tidak pernah terekspos ke log atau UI renderer.
3. **Penyimpanan Aset & Probe Durasi:**
   - File MP3 disimpan ke folder aset proyek (`assets/{projectId}/sfx/...` atau `assets/{projectId}/music/...`).
   - Durasi audio diuji presisi menggunakan FFmpeg `probeDurationMs` sebelum dimasukkan ke database SQLite.

---

## 4. Pendekatan yang Dipertimbangkan & Terpilih

- **Opsi 1: Studio Audio Manual:** Hemat kuota, tapi melelahkan karena harus membuat SFX satu per satu.
- **Opsi 2: Hybrid Smart-Automation (Terpilih):** 1-klik BGM instan + AI Auto-SFX per adegan + generator manual. Sangat cepat, video langsung sinematik, tetap fleksibel.
- **Opsi 3: BGM Saja + SFX Lokal:** Hemat kuota SFX, tapi variasi suara kaku dan terbatas.

---

## 5. Keputusan Teknis & Arsitektur Rinci (Builder Calls)

### A. Strategi Durasi Musik Latar & Efisiensi Kuota (Hasil Konfirmasi)
- **Preset Durasi:** Pengguna dapat memilih durasi musik di Inspector: **30 detik**, **60 detik (bawaan)**, atau **120 detik**.
- **Mekanisme Looping:** Mengingat Bang Story sudah memiliki loop audio otomatis di timeline dan FFmpeg exporter (`-stream_loop -1` di `exporter.ts`), trek 60 detik akan diulang secara mulus sepanjang video dan memudar (fade out) di akhir video. Ini menghemat ratusan kredit ElevenLabs dibanding men-generate trek 10–15 menit penuh.

### B. Siklus Hidup SFX Manual (Preview vs. Commit)
- Pengguna mengetik prompt deskripsi suara & memilih durasi (0.5–10 detik).
- Saat klik **"Buat & Dengarkan Preview"**:
  - Aplikasi memanggil API ElevenLabs satu kali.
  - Hasil audio disimpan di staging lokal dan langsung diputar di modal audio preview.
  - Aset dicatat sementara di state modal.
- Saat klik **"Tambahkan ke Timeline"**:
  - Aset yang sama langsung di-*commit* ke tabel `Asset` proyek dan disisipkan ke timeline (`project.editor.sfx`) pada posisi playhead.
  - Tidak ada re-generate (kuota dijamin hanya terpotong 1x).

### C. Keamanan SFX Berbayar di Timeline
- Pada data `SfxItem`:
  - SFX bawaan gratis menggunakan penanda `auto: true` (sehingga tombol "SFX Otomatis" gratis hanya mengganti SFX lokal).
  - SFX dari ElevenLabs (baik hasil AI Auto-SFX maupun manual) ditandai dengan `auto: false` atau `provider: 'elevenlabs'`.
  - Tombol "SFX Otomatis" gratis di `Timeline.tsx` hanya menghapus SFX dengan aset `provider === 'builtin'`. SFX berbayar ElevenLabs tidak akan pernah terhapus secara tidak sengaja.

### D. Perencana & Eksekusi Batch AI Auto-SFX
- **Fungsi `planSmartSfx(projectId)` (`src/main/story.ts`):**
  - Mengirim ringkasan narasi dan visual prompt tiap babak/adegan ke LLM.
  - LLM merumuskan 3–5 cue penting: nama tampilan bahasa Indonesia (misal: *"Dentang Lonceng Misterius"*), prompt bahasa Inggris untuk ElevenLabs (misal: *"Heavy antique church bell tolling in empty misty town, reverb"*), detik penempatan di timeline, dan durasi.
- **Eksekusi Batch & Partial Success:**
  - Modal di frontend menampilkan daftar cue yang disarankan. Pengguna dapat memilih/centang cue yang ingin di-generate.
  - Eksekusi berjalan sekuensial dengan progress bar di UI ("Men-generate efek 2 dari 4...").
  - Jika terjadi kendala jaringan atau kuota habis di tengah proses (misal cue ke-3 gagal), semua cue yang sudah berhasil di-generate tetap disimpan dan dipasang ke timeline. Tidak ada rollback yang membuang kuota.

---

## 6. Antarmuka Pengguna (UI / UX)

1. **Inspector Tab Musik (`src/renderer/src/pages/project/editor/Inspector.tsx`):**
   - Kartu terintegrasi "Generate dengan ElevenLabs" di bawah prompt musik AI.
   - Pilihan preset durasi: 30s / 60s (default) / 120s.
   - Tombol aksi utama "Generate Musik Latar".
   - Indikator progres berputar saat proses berlangsung.
   - Audio langsung otomatis terpasang sebagai musik aktif proyek begitu selesai.
2. **Timeline Track SFX (`Timeline.tsx`):**
   - Menu tombol `+` di track SFX:
     - *SFX Bawaan (Gratis)* -> katalog 7 suara bawaan.
     - *AI Auto-SFX (ElevenLabs)* -> membuka modal review cue audio cerita.
     - *Buat SFX Kustom (ElevenLabs)* -> membuka modal generator prompt manual.
   - Modal Generator Manual: input teks, pilihan durasi, pemutar audio pratinjau, dan tombol "Tambahkan ke Timeline".
   - Modal AI Auto-SFX: daftar kartu cue yang diidentifikasi dari naskah, tombol uncheck per item, tombol "Generate Terpilih", dan progress bar.

---

## 7. Rencana Pengujian & Verifikasi

1. **Verifikasi Tipe & Kompilasi:**
   - `npm run typecheck` bersih (tanpa error di Node & Web).
   - `npm run build` berhasil tanpa kendala.
2. **Pengujian Fungsional:**
   - Generate BGM dengan preset 60s: pastikan audio terunduh, durasi ter-probe, dan masuk ke track musik timeline.
   - Generate manual SFX: pastikan preview berbunyi, aset tersimpan, dan masuk ke timeline pada playhead.
   - Jalankan AI Auto-SFX: pastikan LLM mendeteksi momen naskah, batch berjalan rapi, dan semua SFX terpasang pada waktu yang tepat.
   - Verifikasi pemutaran di Editor player dan ekspor FFmpeg.
