# Rencana Implementasi: Flow Narasi Baru (Gaya Narasi + Kerangka Bab)

## Ringkasan

Narasi yang dihasilkan sering tidak sesuai ide kreator dan terasa kaku. Penyebabnya ada dua:

1. **Isi melenceng.** Ide diringkas ulang berkali-kali (brief → hook → kerangka → narasi). Batas "satu poin wajib per
   tiga adegan" membuang detail pada video pendek. Hook dibuat dari brief, bukan dari ide. Pemeriksaan akhir
   (`reviewScript`) tidak membaca sinopsis sama sekali.
2. **Gaya tidak cocok.** Prompt meminta "prosa lisan seperti narator", hasilnya gaya dokumenter padat. Kreator
   ingin gaya bercerita yang dekat dengan penonton ("Bayangkan kamu…", pertanyaan beruntun, bab yang jelas,
   kalimat pendek).

Flow baru:

```
LAMA:  Ide → Brief → Pilih Hook → Kerangka babak → Narasi → Potong → Catatan adegan → Periksa
BARU:  Ide + Gaya → Kerangka Bab → Narasi → Periksa (kesetiaan + gaya) → Potong per adegan → Catatan adegan
```

Contoh hasil yang sudah disetujui kreator (pajak = Edukasi santai, kuyang = Horor) menjadi acuan mutu untuk evaluasi.

## Keputusan desain

- **Gaya narasi dipilih di langkah Ide.** Bawaan: *Edukasi santai*, *Horor / cerita rakyat*, *Dokumenter*,
  *Cerita fiksi*, ditambah *Ikuti contoh saya*. Tiap gaya adalah resep berisi aturan tertulis (bukan contoh teks
  yang disalin). Resep disimpan di main process karena hanya dipakai prompt.
- **Brief, hook, dan kerangka digabung menjadi satu Kerangka Bab** yang dibuat dalam satu panggilan LLM dan bisa
  diedit: judul video, pertanyaan yang wajib terjawab, adegan pembuka, daftar bab (judul + isi + satu detail kunci),
  penutup, dan hal yang dihindari. Tidak ada lagi tahap ringkas ulang.
- **Hook tidak lagi wajib dipilih.** Pembuka ditulis AI dari kerangka. Kreator tetap bisa mengisi "kalimat pembuka
  sendiri" (opsional). Kalau diisi, narasi wajib diawali kalimat itu, seperti aturan hook yang sekarang.
  *(Default ini dipilih karena kreator belum menjawab; mudah diubah.)*
- **Judul bab hanya menjadi struktur** (judul babak di timeline), tidak dibacakan dan tidak tampil di video.
  Teks judul bab di layar masuk daftar ide lanjutan. *(Default, mudah diubah.)*
- **Jumlah bab mengikuti durasi**, bukan memadatkan kalimat: ±2–3 bab untuk 1 menit, 4–5 untuk 3 menit, 7–9 untuk
  5–6 menit, lalu bertambah sampai batas 8 babak per kelompok penulisan yang sudah ada.
- **Sinopsis asli selalu ikut** ke penulisan narasi, catatan adegan, dan pemeriksaan sebagai sumber kebenaran utama.
- **Pemeriksaan gaya dilakukan oleh kode tanpa AI** (cepat dan gratis), sedangkan AI hanya menulis ulang bagian yang
  ditandai. Pemeriksaan kesetiaan memakai satu panggilan AI yang membaca sinopsis dan kerangka.
- **Contoh narasi favorit** diubah AI menjadi *profil gaya* (aturan ritme dan teknik). Prompt penulisan hanya memakai
  profil itu, tidak pernah memakai teks contoh langsung, supaya isinya tidak tersalin. Profil disimpan di settings
  (key/value) agar bisa dipakai ulang di proyek lain. Teks contoh hanya dikirim ke layanan LLM yang dipilih pengguna.
- **Tanpa migrasi database.** `StoryPlan` sudah disimpan sebagai JSON di `projects.story_plan_json`; kolom baru di
  plan dibuat opsional agar proyek lama tetap terbuka.
- **Yang tidak berubah:** `narrationSplit.ts`, suara satu rekaman, Whisper/caption, revisi per adegan
  (`rewriteScene`), rencana visual, dan seluruh alur setelah langkah Naskah.

## Daftar tugas

### Fase 1: Model data dan resep gaya

- [ ] **Tugas 1 — Perluas tipe `StoryPlan` secara kompatibel.** Tambahkan `style` (id gaya), `question`, `opening`,
  `customOpening` (opsional), `closing`, `avoid`, `factMode`, `factsToVerify`, dan `keyDetail` per `StoryAct`.
  Semua field baru opsional. Tulis satu fungsi normalisasi yang mengubah plan lama (brief + hook + acts) menjadi
  bentuk baru: hook lama jadi `customOpening`, `brief.mustCover` disebar ke bab.
  - Kriteria selesai: proyek lama dan proyek baru terbuka tanpa error; plan lama tetap bisa membuat naskah.
  - Verifikasi: `npm run typecheck`; buka proyek seed lama lewat dev harness.
  - Berkas: `src/shared/types.ts`, `src/main/story.ts`.
  - Ketergantungan: tidak ada.

- [ ] **Tugas 2 — Tulis resep gaya bawaan.** Buat `src/main/storyStyles.ts` berisi resep empat gaya: aturan
  pembuka, aturan per bab, aturan penutup, sapaan, humor, penanda cerita rakyat, tag suara, dan ambang cek gaya
  (misalnya maksimal kata ragu, panjang kalimat). Aturan diambil dari analisis contoh kreator:
  - *Edukasi santai:* "Bayangkan kamu…", perbandingan zaman sekarang, pertanyaan beruntun lalu "Ternyata…",
    satu fakta mengejutkan per bab, humor sesekali, penutup = ulang pertanyaan + rangkuman + kalimat pamungkas.
  - *Horor / cerita rakyat:* adegan "kamu" di pembuka, "menurut cerita yang beredar" sekali, detail pancaindra,
    akhir bab menggantung, tanpa humor, tag `<whispers>`/`<long pause>` di momen puncak, penutup yang membuat merinding.
  - Semua gaya: satu kalimat per baris, kalimat pendek, judul bab tidak dibacakan, kata ragu ("mungkin") dibatasi.
  - Kriteria selesai: resep bisa dipanggil per id; `FORMAT_GUIDE`/`FACT_RULE` lama dipakai ulang, bukan diduplikasi.
  - Berkas: `src/main/storyStyles.ts` (baru), `src/main/story.ts`.
  - Ketergantungan: Tugas 1.

### Checkpoint 1

- [ ] Tipe dan resep disepakati; typecheck bersih; proyek lama tidak rusak.

### Fase 2: Kerangka Bab

- [ ] **Tugas 3 — Ganti brief + hook + outline dengan `generateChapterPlan`.** Satu panggilan LLM membaca sinopsis,
  durasi, bahasa, dan resep gaya, lalu mengembalikan seluruh Kerangka Bab. Hapus batas "satu poin per tiga adegan".
  Jumlah adegan per bab tetap diratakan dengan `balanceActs`. Sifat isi (`factual`/`folklore`/`fiction`) ditebak
  otomatis dan bisa diubah kreator.
  - Kriteria selesai: untuk ide "Kuyang hantu Kalimantan" dan "Bagaimana pajak pertama kali diciptakan?", kerangka
    berisi pertanyaan, pembuka, bab dengan detail kunci, dan penutup yang sesuai ide tanpa diubah jadi cek fakta.
  - Verifikasi: jalankan lewat dev harness pada 1, 3, dan 6 menit; periksa JSON plan lewat `console.log`.
  - Berkas: `src/main/story.ts`.
  - Ketergantungan: Tugas 1 dan 2.

- [ ] **Tugas 4 — Sambungkan IPC dan halaman Ide.** Tambah IPC `story.chapterPlan` di tiga tempat (`ipc.ts`,
  `shared/api.ts`, `preload/index.ts`). Di `IdeaStep.tsx`: pemilih gaya (komponen `Select`, bukan `<select>`),
  editor Kerangka Bab (pakai ulang editor kerangka yang ada), kolom opsional "kalimat pembuka sendiri". Hilangkan
  langkah pilih hook dari alur utama. Teks UI berbahasa Indonesia santai.
  - Kriteria selesai: kreator bisa memilih gaya, membuat kerangka, mengedit bab, lalu lanjut ke Naskah.
  - Verifikasi: dev harness + screenshot + isi halaman lewat `console.log`.
  - Berkas: `src/main/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/renderer/src/pages/project/IdeaStep.tsx`.
  - Ketergantungan: Tugas 3.

### Fase 3: Penulisan narasi

- [ ] **Tugas 5 — Tulis narasi memakai resep gaya.** Ubah `draftSystem`/`planContext`/`draftActs`: masukkan resep
  gaya, pertanyaan, pembuka, detail kunci per bab, penutup, dan sinopsis asli. Narasi ditulis satu kalimat per baris.
  Validasi awalan hook hanya berlaku bila `customOpening` diisi. Penulisan per kelompok untuk naskah panjang tetap
  dipertahankan.
  - Kriteria selesai: hasil untuk ide pajak dan kuyang setara dengan contoh yang sudah disetujui kreator
    (ada "kamu", pertanyaan beruntun/adegan pembuka, bab jelas, penutup berpamungkas).
  - Verifikasi: bandingkan berdampingan dengan contoh acuan; cek panjang narasi vs target durasi (±15%).
  - Berkas: `src/main/story.ts`.
  - Ketergantungan: Tugas 3.

- [ ] **Tugas 6 — Fitur "Contoh narasi favorit".** Kreator menempel satu atau lebih narasi. AI menghasilkan profil
  gaya (aturan, bukan teks), disimpan bernama di settings, lalu muncul sebagai pilihan gaya "Ikuti contoh saya".
  Kreator bisa melihat, mengubah, dan menghapus profil.
  - Kriteria selesai: profil dari dua contoh kreator (manusia purba, pajak) menghasilkan narasi bergaya serupa
    untuk ide lain tanpa menyalin kalimat contoh (cek tidak ada kalimat ≥8 kata yang sama persis).
  - Verifikasi: dev harness dengan folder data sementara `STUDIO_USER_DATA`.
  - Berkas: `src/main/story.ts`, `src/main/settings.ts`, IPC tiga tempat, `IdeaStep.tsx` atau halaman Pengaturan.
  - Ketergantungan: Tugas 2 dan 5.

### Checkpoint 2

- [ ] Kreator menilai narasi pajak dan kuyang hasil aplikasi; dianggap setara dengan contoh acuan.
- [ ] Typecheck dan build bersih.

### Fase 4: Pemeriksaan

- [ ] **Tugas 7 — Cek gaya tanpa AI.** Buat `src/main/styleCheck.ts`: hitung kata ragu, kalimat terlalu panjang,
  kata yang diulang berlebihan dalam satu bab, sapaan "kamu" (untuk gaya yang memintanya), dan baris yang memuat
  lebih dari satu kalimat. Ambang diambil dari resep gaya. Hasilnya menjadi daftar instruksi perbaikan per bab.
  - Kriteria selesai: narasi contoh kreator "manusia purba" memicu peringatan kata "mungkin"; narasi acuan pajak lolos.
  - Berkas: `src/main/styleCheck.ts` (baru), `src/main/story.ts`.
  - Ketergantungan: Tugas 2.

- [ ] **Tugas 8 — Pemeriksaan kesetiaan dan daftar fakta.** Ubah `reviewScript` agar membaca sinopsis asli dan
  Kerangka Bab: pertanyaan terjawab, semua bab ada, detail kunci muncul, tidak ada arah yang dihindari. Gabungkan
  dengan hasil Tugas 7; tulis ulang hanya bagian yang ditandai (batas `MAX_REVIEW_FIXES` tetap). Untuk sifat isi
  `factual`, simpan `factsToVerify` (nama, tahun, angka) dan tampilkan di langkah Naskah.
  - Kriteria selesai: kegagalan pemeriksaan tidak membuang naskah; daftar fakta muncul untuk ide pajak, tidak
    muncul untuk kuyang.
  - Berkas: `src/main/story.ts`, `src/renderer/src/pages/project/ScriptStep.tsx`.
  - Ketergantungan: Tugas 5 dan 7.

### Checkpoint 3

- [ ] Pemeriksaan menangkap masalah yang disengaja (bab dihapus, kata "mungkin" berlebihan, kalimat panjang).
- [ ] Bagian yang tidak ditandai tidak ikut berubah.

### Fase 5: Kompatibilitas dan penyelesaian

- [ ] **Tugas 9 — Pastikan potongan adegan, suara, dan caption tidak regresi.** Narasi baru (satu kalimat per baris)
  dipotong dengan `splitNarration` yang ada. Catatan adegan (`writeSceneNotes`) ikut menerima sinopsis dan judul bab.
  Proyek lama dengan hook/brief tetap bisa menulis ulang naskah.
  - Verifikasi: dev harness `{"main":"seed"}` lalu buat naskah, narasi satu rekaman, dan ekspor; periksa durasi
    video vs audio dengan ffmpeg.
  - Berkas: `src/main/story.ts`, `src/main/narrationSplit.ts` (hanya bila perlu).
  - Ketergantungan: Tugas 5 dan 8.

- [ ] **Tugas 10 — Evaluasi akhir dan dokumentasi.** Uji tiga ide (pajak, kuyang, manusia purba bosan) pada 1, 3,
  dan 6 menit di tiap gaya yang relevan. Perbarui `docs/alur-produksi.md` (flow baru), `docs/keputusan-teknis.md`
  (kenapa brief/hook digabung, kenapa contoh tidak dikirim langsung), dan `CHANGELOG.md`.
  - Verifikasi wajib: `npm run typecheck`, `npm run build`, dev harness dengan `STUDIO_USER_DATA` sementara.
  - Ketergantungan: semua tugas sebelumnya.

## Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Video 1 menit terlalu sempit untuk gaya bercerita | Narasi terpotong atau terlalu padat | Kurangi jumlah bab, bukan memadatkan kalimat; peringatkan kreator bila ide butuh durasi lebih panjang |
| AI menyalin kalimat dari contoh narasi favorit | Konten tidak orisinal | Prompt hanya memakai profil gaya; cek kalimat kembar ≥8 kata sebelum menyimpan |
| Gaya horor menyudutkan suku atau daerah tertentu | Konten sensitif | Aturan resep: bingkai sebagai cerita rakyat, tidak menuduh kelompok nyata; masuk daftar "hindari" bawaan |
| Fakta karangan pada gaya edukasi | Kredibilitas channel turun | `FACT_RULE` tetap berlaku; tampilkan `factsToVerify` untuk dicek kreator |
| Plan lama tidak kompatibel | Proyek lama gagal dibuka/ditulis ulang | Field baru opsional + normalisasi plan lama (Tugas 1) |
| Kalimat pendek membuat adegan terlalu banyak/sedikit | Tempo visual tidak cocok | Tetap gabungkan kalimat di batas kalimat dengan partisi linear yang ada |
| Panjang narasi meleset dari durasi | Video terlalu panjang/pendek | Cek jumlah kata vs target di Tugas 5; minta tulis ulang bab yang meleset jauh |

## Di luar cakupan

- Menampilkan judul bab sebagai teks di layar video (overlay).
- Resep gaya untuk bahasa selain bahasa proyek (resep ditulis dalam bahasa Inggris, narasi mengikuti bahasa proyek).
- Mengubah rencana visual, TTS, Whisper, caption, atau ekspor.
- Berbagi profil gaya antar pengguna.

> Rencana sebelumnya (Hook, Narasi, Flow2API, Higgsfield) sudah dikerjakan di commit `3a0f477` dan tersimpan di
> riwayat git.
