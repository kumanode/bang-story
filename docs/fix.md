# Rencana Perbaikan Putaran Berikutnya (fix.md)

Isi lama dokumen ini (review pembaruan editor, B1–B12) sudah selesai dikerjakan dan masuk di commit `32bbfe9`.
Dokumen ini sekarang berisi rencana putaran berikutnya: perbaikan caption gaya baru, durasi video sampai
30 menit, ekspor bertahap dengan opsi GPU (NVENC), glitch timeline, dan beberapa optimasi.

Semua butir bisa dikerjakan sekali jalan mengikuti [Urutan pengerjaan](#urutan-pengerjaan), lalu diperiksa
dengan [Daftar periksa verifikasi](#daftar-periksa-verifikasi).

## Ringkasan

| # | Prioritas | Area | Pekerjaan |
|---|---|---|---|
| C1 | 🔴 Tinggi | Caption (pratinjau) | Spasi setelah kata aktif hilang → kata aktif menempel ke kata berikutnya |
| C2 | 🔴 Tinggi | Caption (keduanya) | Jarak antar-kata untuk gaya pop/kapsul tidak memberi ruang untuk pembesaran 115% |
| C3 | 🔴 Tinggi | Caption (ekspor) | `\fscx115` membuat libass menata ulang baris → baris bergeser setiap kata berganti |
| C4 | 🟠 Sedang | Caption (ekspor) | Kapsul Kata ditiru dengan outline tebal, bukan kapsul sungguhan |
| C5 | 🟡 Rendah | Caption | Animasi pop singkat yang sama di pratinjau dan ekspor |
| G1 | 🔴 Tinggi | Timeline | Glitch/berkedip saat zoom 1× (timeline pas selebar panel) |
| D1 | 🔴 Tinggi | Durasi | Pilihan durasi 15, 20, 25, 30 menit + jumlah adegan bertingkat |
| D2 | 🔴 Tinggi | Naskah | Naskah panjang ditulis bertahap (kerangka babak → adegan per kelompok) |
| D3 | 🔴 Tinggi | Visual | Rencana visual per kelompok adegan, bukan satu panggilan |
| D4 | 🟠 Sedang | Biaya | Estimasi adegan & kredit + konfirmasi untuk video panjang |
| D5 | 🟠 Sedang | Whisper | Pastikan pengenalan kata untuk narasi 30 menit tetap stabil |
| E1 | 🔴 Tinggi | Ekspor | Ekspor bertahap (blok video, audio dicampur terpisah, langkah akhir) |
| E2 | 🟠 Sedang | Ekspor | Opsi encoder GPU NVIDIA (NVENC) dengan deteksi dan fallback ke CPU |
| E3 | 🟠 Sedang | Ekspor | Cek ruang disk sebelum ekspor |
| O1 | 🟠 Sedang | Editor | Timeline & Storyboard tetap ringan untuk ±300 klip |
| O2 | 🟠 Sedang | Caption | Sinkron Whisper tidak menimpa caption yang diedit tangan |
| O3 | 🟡 Rendah | Ekspor | Lanjutkan ekspor yang gagal tanpa merender ulang klip yang sudah jadi |
| DOC | — | Dokumentasi | Catat keputusan baru di docs/ |

---

## A. Caption gaya baru

Berlaku untuk gaya dengan `popScale`, `pill`, atau `glowColor`: Hormozi, Kapsul Kata, Merah Darah, Bisikan Arwah,
Api Ritual. Gaya lama (Karaoke, Tebal, Minimal, Subtitle, dll.) tidak terdampak.

Gejala yang dilaporkan: hasil caption baru berantakan dan berbeda dengan caption lama; jarak antar-kata sangat
rapat ketika caption berjalan (kata aktif berpindah).

### C1. Spasi setelah kata aktif hilang di pratinjau

**Lokasi:** [Player.tsx](../src/renderer/src/pages/project/editor/Player.tsx), komponen caption (render `<span>` per kata).

**Masalah:** spasi antar-kata ditaruh di dalam span kata (`{word}{' '}`). Saat kata aktif, span itu menjadi
`display: inline-block`. Dengan `white-space: nowrap`, spasi di ujung isi inline-block dibuang browser, sehingga
kata aktif menempel ke kata sesudahnya. Karena kata aktif berpindah, celah yang hilang ikut berpindah → terlihat
"berantakan" saat caption berjalan.

**Perbaikan:** render spasi sebagai node tersendiri di antara span kata (di luar span), sehingga tidak pernah
berada di dalam inline-block.

### C2. Jarak antar-kata tidak memberi ruang untuk pembesaran

**Masalah:** kata aktif dibesarkan 115% (`CAPTION_ACTIVE_SCALE`). Di pratinjau, `transform: scale()` tidak
menambah lebar sehingga kata meluber ±7,5% ke kiri dan kanan dan menutup spasi. Kapsul menambah padding lagi.

**Perbaikan:**
- Tambah konstanta di [captions.ts](../src/shared/captions.ts), misalnya `CAPTION_POP_GAP` (jarak antar-kata
  tambahan dalam em, hanya untuk gaya `popScale`/`pill`), dihitung cukup untuk `(scale − 1) / 2 × lebar kata`
  ditambah padding kapsul.
- `layoutCaptionLines` dan fungsi ukur di kedua sisi memperhitungkan jarak tambahan ini, supaya pemenggalan baris
  tetap sama di pratinjau dan ekspor (aturan 1 AGENTS.md).
- Pratinjau: `word-spacing`/margin dari konstanta itu.
- Ekspor: spasi yang dilebarkan dengan `{\fscxN} {\fscx100}` (hanya karakter spasi yang diskalakan), N dihitung
  dari konstanta yang sama dan lebar spasi font dari `fontMetrics.ts`.

### C3. Baris di ekspor bergeser setiap kata aktif berganti

**Lokasi:** [exporter.ts](../src/main/exporter.ts) `captionEvents` (`scaleTag`, `scaleReset`).

**Masalah:** `\fscx115\fscy115` mengubah lebar kata di dalam baris, libass menata ulang dan memusatkan ulang
baris, jadi seluruh baris bergeser sedikit setiap kata berganti. Pratinjau (transform) tidak bergeser →
pratinjau ≠ ekspor.

**Perbaikan:** kunci tata letak baris.
- Baris dasar selalu digambar 100%; kata aktif di baris dasar dibuat transparan (`\alpha&HFF&`).
- Kata aktif yang membesar digambar sebagai event terpisah di layer atas dengan `\an5\pos(x,y)` di titik tengah
  kata. Posisi x dihitung dari lebar teks sebelum kata (via `fontMeasure`), y dari baris dan `lineH`.
- Layer glow (gaya `glowColor`) memakai posisi yang sama.
- Fungsi posisi kata ditaruh di `src/shared/captions.ts` supaya pratinjau bisa memakai hitungan yang sama
  kalau diperlukan.

### C4. Kapsul Kata di ekspor bukan kapsul sungguhan

**Masalah:** ekspor meniru kapsul dengan `\bord` kuning tebal di sekeliling huruf. Bentuknya mengikuti glyph,
dan border tidak menambah lebar sehingga memakan spasi. Pratinjau memakai kapsul sungguhan (background,
radius, padding).

**Perbaikan:** gambar kapsul sebagai event `\p1` rounded rect (`roundedRectPath`, seperti `CapBox`) di layer di
bawah kata aktif, dengan posisi dari C3 dan ukuran padding/radius dari konstanta bersama di `captions.ts`
(menggantikan angka `0.22`/`0.25` yang sekarang tertulis di Player).

### C5. Animasi pop (opsional, dikerjakan setelah C1–C4)

Pop instan terasa kaku. Tambahkan animasi masuk singkat (±80 ms):
- Ekspor: `\t(0,80,\fscx115\fscy115)` pada event kata aktif (mulai dari 100%).
- Pratinjau: hitung skala dari waktu sejak kata aktif mulai (bukan CSS `transition`, supaya scrub/seek tetap
  sama dengan ekspor). Durasi animasi jadi konstanta di `captions.ts`.

---

## B. Glitch timeline

### G1. Timeline berkedip saat zoom 1×

**Gejala:** saat timeline pas dengan lebar panel (zoom 1×), editor glitch/berkedip; setelah di-zoom, hilang.

**Lokasi:** [Timeline.tsx](../src/renderer/src/pages/project/editor/Timeline.tsx): `ResizeObserver` →
`setWidth(el.clientWidth)` dan `pps = (width − ORIGIN − 16) / total × zoom`.

**Dugaan penyebab (perlu dibuktikan dengan dev harness):** loop scrollbar. Di zoom 1×, lebar konten persis sama
dengan lebar panel. Sedikit saja melebihi (pembulatan subpiksel, atau blok dengan lebar minimum seperti SFX
`Math.max(36, …)` dan caption `Math.max(10, …)` di ujung timeline) → scrollbar horizontal muncul → tinggi area
berkurang → scrollbar vertikal muncul → `clientWidth` mengecil → `pps` mengecil → konten muat lagi → scrollbar
hilang → `clientWidth` membesar lagi → berulang. Saat di-zoom, konten selalu lebih lebar dari panel, scrollbar
stabil, loop berhenti.

**Perbaikan:**
- `scrollbar-gutter: stable` pada kontainer scroll supaya lebar tidak berubah karena scrollbar vertikal.
- Di zoom 1×, sisakan margin aman (bulatkan `pps` ke bawah, kurangi beberapa piksel) dan pastikan blok dengan
  lebar minimum tidak melewati ujung konten (lebar konten = maksimum dari ujung semua blok).
- `ResizeObserver` mengabaikan perubahan lebar ≤ 1 px.

---

## C. Durasi video sampai 30 menit

### D1. Pilihan durasi dan jumlah adegan

**Lokasi:** [models.ts](../src/shared/models.ts) `DURATIONS` dan `clipCountFor`.

- Tambah pilihan **15, 20, 25, 30 menit** (dipakai lewat komponen `Select` yang sudah ada di Home).
- `clipCountFor` bertingkat: ±5,5 dtk per adegan untuk video ≤ 10 menit, ±8 dtk untuk video lebih panjang.
  Naikkan batas atas 120 menjadi ±230. Perkiraan: 15 m ≈ 113, 20 m ≈ 150, 25 m ≈ 188, 30 m ≈ 225 adegan.
- Di Home, untuk durasi ≥ 15 menit tampilkan info kecil: perkiraan jumlah adegan (dan kredit, lihat D4).

### D2. Naskah panjang ditulis bertahap

**Lokasi:** [story.ts](../src/main/story.ts) `generateScript`.

**Masalah:** ratusan adegan diminta dalam satu panggilan LLM. Output JSON bisa melebihi batas token model
(terpotong/gagal parse) atau melewati `GENERATE_TIMEOUT_MS` (4 menit).

**Perbaikan (hanya untuk jumlah adegan di atas ambang, misalnya > 60):**
1. Panggilan pertama: judul + kerangka babak (judul babak, ringkasan, jumlah adegan per babak).
2. Panggilan berikutnya: adegan per babak/kelompok (±30 adegan), dengan konteks kerangka lengkap, ringkasan
   babak sebelumnya, dan narasi 2–3 adegan terakhir supaya sambungannya mulus.
3. Progres job per kelompok ("Menulis babak 3 dari 8"); gagal di satu kelompok bisa dicoba ulang tanpa
   mengulang kelompok yang sudah jadi.

Video pendek tetap memakai satu panggilan seperti sekarang.

### D3. Rencana visual per kelompok

**Lokasi:** [story.ts](../src/main/story.ts) `generateVisuals`.

**Masalah:** sama dengan D2, dan output per adegan lebih panjang (setting, action, framing, motion, dll.).

**Perbaikan:** proses `targets` per kelompok ±20 adegan. Daftar karakter hasil kelompok sebelumnya dikirim ke
kelompok berikutnya supaya tokoh tetap konsisten. Prompt "Full script" untuk kelompok cukup berisi ringkasan
seluruh cerita + naskah lengkap kelompok itu dan tetangganya, supaya prompt tidak membengkak.

### D4. Estimasi biaya dan konfirmasi

Untuk proyek ≥ 10 menit, sebelum generate gambar/video semua adegan, tampilkan jumlah adegan dan estimasi kredit
(memakai estimasi yang sudah ada di `generation.ts`) lalu minta konfirmasi.

### D5. Whisper untuk narasi panjang

Narasi sudah dipecah per bagian (`GEMINI_PART_SEC = 240`, `ELEVEN_PART_CHARS = 2400`). Pastikan `timeScript`
dijalankan per bagian, bukan pada gabungan 30 menit, dan progresnya dilaporkan per bagian. Uji dengan audio
sintetis panjang di dev harness.

---

## D. Ekspor

### E1. Ekspor bertahap

**Lokasi:** [exporter.ts](../src/main/exporter.ts) `renderProject`.

**Masalah:** langkah 3 memasukkan semua segmen video, semua suara klip, overlay, SFX, dan musik ke satu proses
FFmpeg dengan rantai `xfade` sepanjang jumlah klip. Untuk ±225 klip itu ratusan `-i`:
- baris perintah bisa melewati batas Windows (±32.767 karakter),
- semua input dibuka bersamaan → RAM dan handle file membengkak,
- satu kegagalan di akhir mengulang semuanya.

**Perbaikan (tiga tahap):**
1. **Blok video:** segmen dikelompokkan per ±20 klip; tiap blok digabung dengan `xfade` di dalamnya jadi satu file
   perantara. Transisi di batas blok: blok berikutnya dimulai dengan klip yang ikut dirender sebagai bagian
   ekor blok sebelumnya, atau blok digabung lagi dengan `xfade` antar-blok (jumlah input kecil).
2. **Audio:** semua suara klip, SFX, dan musik dicampur dulu jadi satu WAV (juga bertahap per blok kalau
   inputnya banyak), dengan aturan yang sama (`voiceSpan`, gain, ducking).
3. **Langkah akhir:** video gabungan + WAV + overlay gambar + caption ASS → encode MP4 final.

Proyek pendek boleh tetap satu tahap, tapi lebih aman memakai jalur yang sama untuk semua (satu jalur = satu
perilaku). Paritas dengan pratinjau tidak berubah karena aturan tetap dari `src/shared/`.

### E2. Opsi encoder GPU NVIDIA (NVENC)

- Dialog ekspor: pilihan **Kualitas terbaik (CPU)** (bawaan, libx264 seperti sekarang) dan
  **Cepat (GPU NVIDIA)**. Pilihan GPU hanya muncul kalau terdeteksi.
- Deteksi di main: `ffmpeg -encoders` berisi `h264_nvenc`, lalu uji encode singkat (beberapa frame `lavfi`)
  karena encoder bisa ada tapi GPU/driver tidak mendukung. Hasil deteksi di-cache per sesi; butuh IPC baru
  (aturan 5: `ipc.ts`, `api.ts`, `preload/index.ts`).
- Parameter NVENC dengan kualitas setara: `-c:v h264_nvenc -preset p5 -tune hq -rc vbr -cq 19 -b:v 0`
  (`-cq` mengikuti crf yang sekarang: 19, atau 20 untuk 2160p). Opsi encoder disimpan di `ExportOptions`.
- Kalau encode NVENC gagal di tengah, ulangi langkah itu otomatis dengan libx264 dan beri tahu pengguna.
- NVENC dipakai untuk langkah akhir dan blok perantara; segmen per klip boleh ikut memakai NVENC.
- Catatan untuk pengguna (tooltip): GPU jauh lebih cepat, kualitas sedikit di bawah CPU pada ukuran file yang
  sama, dan file bisa sedikit lebih besar.

### E3. Cek ruang disk

Sebelum ekspor, perkirakan kebutuhan folder `tmp` (durasi × bitrate perantara) + file akhir, bandingkan dengan
ruang kosong (`fs.statfs`), dan tolak dengan pesan jelas kalau tidak cukup.

---

## E. Optimasi lain

### O1. Editor ringan untuk ratusan klip

- Timeline: render hanya blok yang terlihat di area scroll (plus sedikit cadangan); thumbnail klip dimuat lazy.
- Storyboard: daftar adegan divirtualisasi atau dimuat bertahap; gambar `loading="lazy"`.
- Uji dengan proyek seed 225 klip: scroll, zoom, drag, dan putar tetap lancar.

### O2. Sinkron Whisper tidak menimpa edit caption manual

Sudah tercatat di [masalah-diketahui.md](masalah-diketahui.md). `syncCaptions` melewati klip dengan
`meta.editedWords`, dan UI memberi tahu berapa klip yang dilewati (dengan opsi "timpa juga").

### O3. Lanjutkan ekspor yang gagal

Simpan segmen/blok perantara dengan kunci hash (isi klip + opsi ekspor). Ekspor ulang memakai file yang masih
valid, jadi gagal di menit ke-25 tidak mengulang dari nol. Bersihkan cache setelah ekspor berhasil atau saat
proyek dihapus.

---

## Dokumentasi yang perlu diperbarui

- [keputusan-teknis.md](keputusan-teknis.md): tata letak caption terkunci (kata aktif di layer terpisah),
  jarak pop, kapsul `\p1`, ekspor bertahap, NVENC dan fallback-nya, naskah/visual bertahap.
- [editor-dan-ekspor.md](editor-dan-ekspor.md): alur ekspor tiga tahap, pilihan encoder, cek disk.
- [alur-produksi.md](alur-produksi.md): durasi sampai 30 menit, naskah bertahap.
- [masalah-diketahui.md](masalah-diketahui.md): hapus butir yang selesai (O2), tambah catatan yang tersisa.
- `CHANGELOG.md`.

---

## Urutan pengerjaan

1. **C1–C4** caption (lalu C5 kalau waktu cukup). Cek pratinjau vs frame ekspor per gaya.
2. **G1** glitch timeline.
3. **D1** pilihan durasi + `clipCountFor`.
4. **D2, D3** naskah dan visual bertahap.
5. **E1** ekspor bertahap, lalu **E3** cek disk.
6. **E2** NVENC (di atas E1).
7. **D4, D5** estimasi biaya, Whisper panjang.
8. **O1, O2, O3**.
9. Dokumentasi.

Setiap langkah: `npm run typecheck` dan `npm run build` bersih sebelum lanjut.

## Daftar periksa verifikasi

- [ ] Caption: untuk kelima gaya baru, screenshot pratinjau dan frame ekspor di beberapa titik waktu; jarak
      antar-kata tetap lapang, baris tidak bergeser saat kata aktif berganti, kapsul berbentuk kapsul.
- [ ] Caption gaya lama (Karaoke, Tebal, Subtitle) tidak berubah dibanding sebelum perbaikan.
- [ ] Timeline zoom 1×: tidak berkedip saat jendela diubah ukurannya, saat ada SFX/caption di ujung, dan saat
      timeline ditinggikan/diperkecil.
- [ ] Durasi 30 menit: naskah ±225 adegan terbentuk lengkap tanpa adegan hilang atau dobel di batas kelompok.
- [ ] Rencana visual: semua adegan terisi, karakter konsisten antar-kelompok.
- [ ] Ekspor proyek seed panjang (±225 klip, audio sintetis): selesai tanpa error; durasi video vs audio selisih
      < 0,1 dtk; transisi di batas blok terlihat benar; pemakaian RAM wajar.
- [ ] Ekspor NVENC (di mesin dengan GPU NVIDIA) dan fallback CPU (paksa gagal) sama-sama menghasilkan MP4 valid.
- [ ] Cek disk menolak ekspor dengan pesan jelas saat ruang tidak cukup.
- [ ] Editor dengan ±225 klip: scroll, zoom, drag, dan putar tetap lancar.
- [ ] Semua pengujian memakai folder data sementara (`STUDIO_USER_DATA`).
