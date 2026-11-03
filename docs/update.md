# Rencana Pembaruan Bang Story (update.md)

Dokumen ini memuat rencana kerja terstruktur untuk meningkatkan kemampuan **editing**, **kualitas audio-visual**, **ergonomi antarmuka (UI/UX)**, dan **fitur AI end-to-end** di Bang Story.

> **Catatan desain:** Sesuai keputusan, bilah navigasi tab editor di sebelah kiri (84 px) tetap dipertahankan seperti aslinya.

---

## Peta Jalan Pengembangan (Roadmap)

Pembaruan dibagi menjadi 4 fase agar setiap tahap dapat langsung diuji dan stabil sebelum melangkah ke fitur berikutnya:

```
Fase 1: Fondasi Keamanan & Ergonomi Editor (Undo/Redo, Resizable Timeline, Track Controls, Player Precision)
   │
Fase 2: Estetika Sinematik & Caption (Color Grading, Transisi Tambahan, Custom Framing, Kinetic Captions)
   │
Fase 3: Audio Multi-Track & Fleksibilitas Media (Track SFX, Ganti Media Klip / B-Roll Lokal)
   │
Fase 4: AI Lanjutan & Kemasan YouTube (Multi-Voice TTS Dialog, YouTube Packaging & Auto Chapters)
```

---

## Fase 1: Fondasi Keamanan & Ergonomi Editor

Fokus fase ini adalah membuat editor terasa aman, fleksibel di berbagai ukuran layar, dan presisi saat digunakan.

### 1.1 Sistem Undo / Redo Global (`Ctrl+Z` / `Ctrl+Y`)
* **Tujuan:** Menghilangkan rasa takut salah edit saat memotong klip, menghapus elemen, menggeser caption, atau mengubah volume.
* **Cakupan Aksi yang Dicatat:**
  * Penataan klip: `split`, `removeClip`, `reorderClips`.
  * Penyesuaian waktu: *trimming* durasi klip, pergeseran suara narasi (`voiceInMs`, `voiceStartMs`), dan *caption retiming*.
  * Elemen pelengkap: tambah/edit/hapus *overlay*, penyesuaian musik latar, perubahan transisi.
* **Implementasi Teknis:**
  * Tambahkan riwayat snapshot di store Zustand (`src/renderer/src/store/project.ts`) menggunakan middleware temporal atau stack riwayat aksi terbatas (misal 30 langkah terakhir).
  * Pasang penangkap shortcut `Ctrl+Z` (Undo) dan `Ctrl+Shift+Z` / `Ctrl+Y` (Redo) di `src/renderer/src/pages/project/EditorStep.tsx`.
  * Sinkronkan aksi yang membutuhkan penyimpanan proses utama (seperti `split` dan `setWords`) dengan mekanisme rollback yang aman.

### 1.2 Resizable Timeline (Splitter Handle)
* **Tujuan:** Memberikan kendali penuh pada pengguna untuk mengatur proporsi area video Player vs area Timeline sesuai kebutuhan.
* **Implementasi Teknis:**
  * Buat komponen garis pembatas (*splitter bar*) di antara Player dan Timeline pada `EditorStep.tsx`.
  * Tambahkan penanganan event *drag pointer* yang mengatur tinggi timeline secara dinamis dengan batas minimal (misal 180 px) dan batas maksimal (misal 65% dari tinggi jendela).
  * Simpan preferensi tinggi timeline pengguna di `localStorage` agar tidak kembali ke ukuran default saat berpindah halaman.

### 1.3 Track Controls di Timeline (Mute, Hide, & Lock)
* **Tujuan:** Memudahkan evaluasi elemen audio dan visual secara terisolasi tanpa harus mengubah pengaturan permanen di Inspector.
* **Fitur pada Header Track (`src/renderer/src/pages/project/editor/Timeline.tsx`):**
  * **Track Suara TTS & Track Musik:** Tombol *Mute* (ikon speaker) untuk membisukan instrumen musik atau vokal sementara waktu saat memutar pratinjau.
  * **Track Overlay & Caption:** Tombol *Hide* (ikon mata) untuk menyembunyikan teks/logo sementara agar visual di baliknya terlihat jelas.
* **Catatan Arsitektur:** Status *mute/hide* ini murni berada di state renderer (`src/renderer/src/pages/project/editor/engine.ts`) dan hanya memengaruhi pemutaran pratinjau, tidak mengubah file ekspor kecuali pengguna memang menghapusnya.

### 1.4 Kontrol Player Presisi (Step Frame & Safe Area YouTube Shorts)
* **Fitur di `src/renderer/src/pages/project/editor/Player.tsx`:**
  * **Step Frame (+1 / -1 Frame):** Tombol di samping Play/Pause untuk melangkah maju/mundur tepat 1 frame (1/30 detik) guna memotong adegan dengan ketepatan milidetik. Mendukung shortcut keyboard `[` dan `]`, atau panah `←` / `→` saat player aktif.
  * **Pratinjau Layar Penuh (*Cinema Mode*):** Tombol layar penuh dan shortcut `F` untuk memutar video tanpa gangguan antarmuka editor.
  * **Shorts Safe Area Guide (Khusus 9:16):** Tombol toggle overlay panduan yang menampilkan batas antarmuka YouTube Shorts (ikon like/komentar di kanan, dan judul/channel di bawah) agar penempatan caption dan teks overlay tidak tertutup.

### 1.5 Input Angka Langsung & Double-Click Reset pada Slider
* **Peningkatan Komponen:**
  * Setiap slider pengaturan (volume dB di `DbSlider`, opasitas, skala caption, durasi transisi) dilengkapi angka yang bisa diklik untuk mengetik angka bulat secara langsung.
  * Menekan klik dua kali (*double click*) pada bulatan slider akan mengembalikan nilainya ke posisi normal/default (`0 dB`, `100%`, `0,4 dtk`).

### 1.6 Tombol Aksi "Ekspor Video" Utama di Header
* **Lokasi:** `src/renderer/src/pages/project/ProjectHeader.tsx`.
* **Peningkatan:** Saat pengguna berada di langkah **4 Editor**, tampilkan tombol primer **"Ekspor Video"** dengan aksen mencolok di pojok kanan atas bilah header untuk mempercepat alur kerja akhir.

---

## Fase 2: Estetika Sinematik & Caption Dinamis

Fokus fase ini adalah meningkatkan kualitas visual agar setara dengan video hasil produksi studio profesional.

### 2.1 Color Grading & Filter Suasana (Cinematic Looks)
* **Pilihan Gaya:** *Normal*, *Warm Tale*, *Cold Mystery/Horror*, *Cyberpunk/Vibrant*, *Noir (Black & White)*, *Vintage Sepia*.
* **Prinsip Paritas (Preview = Export):**
  * Aturan filter didefinisikan satu kali di `src/shared/filters.ts` (nilai contrast, brightness, saturation, sepia, hue).
  * **Di Pratinjau (`Player.tsx`):** Diterapkan melalui CSS `filter: contrast(...) brightness(...) saturate(...)`.
  * **Di Ekspor (`exporter.ts`):** Diterapkan melalui filter FFmpeg `eq=contrast=...:brightness=...:saturation=...` pada rantai render tiap klip.
* **Penyimpanan Data:** Tambahkan kolom atau properti filter pada model klip/proyek.

### 2.2 Transisi Sinematik Tambahan
* **Penambahan Jenis Transisi:**
  * `dipblack` (meredup ke hitam lalu muncul adegan baru—sangat penting untuk pergantian babak cerita).
  * `dissolve` (dipetakan menjadi kilat putih `fadewhite`, supaya hasil FFmpeg berbeda dari transisi Pudar dan pratinjau menirunya).
  * `wipeleft` / `wiperight`.
* **Implementasi:**
  * Daftarkan di `src/shared/motion.ts` pada array `TRANSITIONS`.
  * Buat padanan gaya animasi CSS-nya di `src/renderer/src/pages/project/editor/transitionStyle.ts`.
  * Pasangkan dengan filter `xfade` bawaan FFmpeg di `src/main/exporter.ts`.

### 2.3 Custom Ken Burns Framing (Titik Fokus Kamera Gambar)
* **Tujuan:** Mengarahkan kamera gambar diam secara presisi ke wajah karakter atau objek tertentu, bukan hanya titik tengah gambar.
* **Antarmuka saat ini:** Framing awal dan akhir diatur dengan slider di Inspector; kontrol kotak interaktif langsung di Player belum dibuat.
* **Teknis:** Koordinat awal dan akhir disimpan sebagai pecahan frame `(x, y, scale)` di `editor.clipFraming`, lalu dihitung interpolasinya untuk transform CSS (Player) dan filter `perspective`/`crop` FFmpeg (Exporter).

### 2.4 Caption Dinamis & Model Baru
* **Model Caption Baru yang Disetujui:**
  * **Hormozi / Viral Shorts (`hormozi`):** Font tebal kapital (ALL CAPS), teks putih outline hitam pekat, kata aktif berwarna hijau neon menyala (`#00FF66`) dengan efek pop scale (1,15×).
  * **Kapsul Kata (`wordpill` - CapCut Signature):** Kalimat tanpa kotak, kata aktif dibungkus kapsul kuning terang (`#FFD000`) dengan teks hitam pekat melompat antar kata.
  * **Edisi Horor & Misteri:**
    * *Merah Darah (`crimson`):* Teks putih tulang, kata aktif menyala merah darah pekat (`#FF1E38`) berdenyut sinister.
    * *Bisikan Arwah (`ghostmist`):* Teks pucat melayang dengan pendaran kabut hijau arwah / spectral cyan (`#00FFB3`).
    * *Api Ritual (`ritual`):* Font serif kuno, teks arang bara dengan nyala oranye bara api lilin (`#FF6600`).
* **Efek Kata Aktif (Kinetic Pop & Glow):**
  * Di Player: CSS transform `scale(1.12–1.15)`, text-shadow glow, dan box pill styling.
  * Di Ekspor: Tag ASS override `\t(\fscx115\fscy115)`, warna ASS `\c`, serta styling outline/shadow di `src/main/exporter.ts`.

### 2.5 Badge Status pada Thumbnail Klip
* **Lokasi:** `StoryboardStep.tsx` dan baris Klip di `Timeline.tsx`.
* **Badge yang Ditampilkan:**
  * `[VIDEO AI]` (jika klip sudah memiliki render video dari Higgsfield) vs `[GAMBAR]` (jika memakai foto diam).
  * `[SYNCED]` (caption sudah presisi dengan Whisper) vs `[ESTIMATE]` (waktu caption masih perkiraan).
  * Durasi klip di sudut thumbnail.

---

## Fase 3: Multi-Track Audio & Fleksibilitas Media

Fokus fase ini adalah menghidupkan suasana audio dan memberi kebebasan memasukkan aset sendiri.

### 3.1 Multi-Track SFX (Efek Suara)
* **Kebutuhan:** Suara transisi (*whoosh*), ketukan pintu, gemuruh petir, suara langkah kaki, atau dentuman dramatis.
* **Fitur:**
  * Track baru di timeline: **Track Efek Suara (SFX)** di bawah Musik.
  * Pustaka SFX lokal bawaan (koleksi file audio esensial bebas royalti di folder `resources/sfx/`).
  * Dukungan drag & drop file audio WAV/MP3 dari komputer pengguna ke timeline SFX.
  * Setiap klip SFX bisa digeser, dipotong awal/akhirnya, dan diatur volumenya.
* **Paritas Render:**
  * Pratinjau disinkronkan di `engine.ts`.
  * Di `exporter.ts`, setiap file SFX ditrim dan digabungkan ke rantai `amix` audio FFmpeg menggunakan delay milidetik (`adelay`).

### 3.2 Ganti Media Klip (File Gambar / Video B-Roll Lokal)
* **Kebutuhan:** Terkadang kreator memiliki rekaman video atau foto ilustrasi sendiri yang ingin disisipkan ke dalam adegan cerita tanpa merusak narasi suara.
* **Antarmuka:** Di panel Klip (Inspector), sediakan tombol **"Ganti dengan File Lokal"** (format PNG, JPG, MP4, WebM).
* **Alur Sistem:**
  * File disalin ke folder aset proyek (`dataDir/projects/<id>/assets/`).
  * Didaftarkan ke tabel `assets` sebagai aset gambar atau video klip tersebut.
  * Video lokal otomatis dipotong mengikuti durasi klip atau durasi narasinya.

---

## Fase 4: Alur AI Lanjutan & Kemasan YouTube

Fokus fase ini adalah otomatisasi cerdas yang melengkapi video dari naskah hingga siap dipublikasikan ke YouTube.

### 4.1 Multi-Voice TTS (Dialog Antar Karakter)
* **Konsep:** Jika adegan naskah berisi dialog karakter (misal ada Narator dan dua tokoh cerita), suara narator tidak monoton satu orang saja.
* **Alur Produksi:**
  * Setiap karakter di `CharacterModal` dapat diasosiasikan dengan suara TTS tertentu (Gemini atau ElevenLabs).
  * Di langkah Naskah / Narasi, baris dialog yang ditandai nama karakter otomatis disuarakan dengan suara tokoh tersebut.
  * Sistem penggabungan audio di `src/main/narration.ts` merangkai potongan dialog menjadi satu kesatuan yang kohesif sebelum dipotong per adegan.

### 4.2 YouTube Packaging & Auto Chapters (Metadata Siap Upload)
* **Lokasi:** `ExportDialog.tsx` dan dialog selesai ekspor.
* **Kemampuan:**
  * **Daftar Bab Otomatis (*Timestamp Chapters*):** Dihitung secara matematis dari waktu mulai tiap klip di timeline. Format siap tempel ke deskripsi YouTube:
    ```
    00:00 - Pembuka
    00:45 - Hutan Terlarang
    02:10 - Rahasia Terbongkar
    ```
  * **Variasi Judul & Deskripsi SEO:** Tombol pembuat judul berdaya tarik tinggi (*high-CTR*) dan ringkasan deskripsi YouTube berbasis naskah.
  * **Pembuat Gambar Thumbnail:** Menghasilkan 2–3 alternatif konsep gambar thumbnail 16:9 beresolusi tinggi dengan fokus wajah ekspresif dan ruang kosong untuk teks judul.

---

## Aturan Teknis & Daftar Periksa Kepatuhan

Setiap pengerjaan fitur pada rencana ini wajib mematuhi aturan baku proyek:

1. **Paritas 1:1 Pratinjau & Ekspor:** Setiap aturan visual atau audio yang memengaruhi hasil akhir harus ditulis di `src/shared/` dan dipanggil secara seimbang oleh Player (renderer) dan Exporter (main).
2. **BYOK & Privasi Kunci:** Kunci API pengguna tidak pernah bocor ke log, berkas, atau pesan error.
3. **Migrasi Database Aman:** Kolom baru pada tabel `clips` atau `projects` hanya ditambahkan di akhir array `MIGRATIONS` (`src/main/db/index.ts`) dan diperbarui di 8 lokasi model data (lihat `docs/data-model.md`).
4. **Kebersihan Kode:** Bebas dari variabel yang tidak terpakai (`noUnusedLocals`, `noUnusedParameters`).
5. **Verifikasi Wajib Sebelum Selesai:**
   ```bash
   npm run typecheck   # wajib bersih (node + web)
   npm run build       # pastikan proses build out/ berhasil
   ```
