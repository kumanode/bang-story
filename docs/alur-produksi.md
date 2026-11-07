# Alur produksi

Satu proyek melewati empat langkah (`Project.step`): **1 Ide → 2 Naskah → 3 Storyboard → 4 Editor**, lalu ekspor.

```
Ide cerita ──LLM──► Naskah (adegan + narasi) ──LLM──► Rencana visual per adegan
                                                     │
            ┌────────────────────────────────────────┼─────────────────────────┐
            ▼                                         ▼                         ▼
   Lembar karakter (Higgsfield)          Gambar klip (Higgsfield)       Narasi satu rekaman (TTS)
            └────────── referensi ──────────────────►│                         │
                                                     ▼                         ▼
                                          Video AI (opsional)        Potong per adegan + Whisper
                                                     └──────────► Editor ◄─────┘
                                                                     │
                                                                  FFmpeg → MP4
```

## 1. Ide → gaya → Kerangka Bab → naskah (`src/main/story.ts`)

- Masukan: sinopsis, target durasi, bahasa.
- Pilihan durasi: 1, 3, 5, 10, 15, 20, 25, atau 30 menit. Untuk durasi sampai 10 menit, targetnya sekitar satu adegan per 5,5 detik; di atas 10 menit sekitar satu adegan per 8 detik. Jumlah dibatasi maksimal 230 dan minimal 3.
- Untuk durasi 15 menit atau lebih, halaman Ide memperlihatkan perkiraan jumlah adegan dan kredit gambar bila model menyediakan estimasi.
- Sebelum membuat gambar atau video pada proyek berdurasi 10 menit atau lebih, aplikasi meminta konfirmasi jumlah adegan dan perkiraan kredit per adegan. Estimasi gambar menggunakan model yang dipilih; layanan yang tidak menyediakan endpoint estimasi tidak menampilkan jumlah kredit.
Urutannya: **sinopsis + gaya → Kerangka Bab yang bisa diedit → narasi per bab → cek gaya lokal + pemeriksaan kesetiaan → potong per adegan → catatan adegan**.

- `generateChapterPlan` membaca sinopsis asli, durasi, bahasa, dan resep gaya dalam satu panggilan LLM. Hasilnya
  berisi judul, pertanyaan yang wajib terjawab, adegan pembuka, sifat isi, bab berisi ringkasan dan satu detail kunci,
  penutup, hal yang dihindari, serta daftar fakta untuk dicek. Kreator dapat menyunting semua bagian itu di langkah Ide.
- Jumlah bab mengikuti durasi: kira-kira 2 bab untuk 1 menit, 4 untuk 3 menit, 7 untuk 5 menit, dan 8 untuk 6 menit.
  Hasil AI yang meleset sampai 2 bab tetap diterima. Total adegan sasaran (`clipCountFor`) dibagi ke semua bab lewat
  `balanceActs`. Naskah ditulis dalam kelompok paling banyak 8 bab. Jumlah adegan pada kerangka adalah sasaran;
  adegan final tetap dibagi di batas kalimat.
- Gaya narasi dipilih di langkah Ide: Edukasi santai, Horor / cerita rakyat, Dokumenter, Cerita fiksi, atau Ikuti
  contoh saya. Resep dan ambang pemeriksaan ada di `src/main/storyStyles.ts`. Contoh yang ditempel hanya dikirim ke
  provider LLM terpilih untuk diekstrak menjadi aturan; yang disimpan di settings hanya nama dan aturan profil.
  Penulisan berikutnya memakai aturan itu tanpa mengirim ulang teks contoh.
- Kalimat pembuka sendiri bersifat opsional. Jika diisi, pembuka narasi harus dimulai dengan teks itu persis; jika
  kosong, AI membuat pembuka dari adegan pembuka dan gaya terpilih. Judul bab hanya menjadi struktur dan tidak dibacakan.
- Aturan kebenaran mengikuti sifat isi: fakta nyata tidak boleh mengarang nama, tanggal, atau angka; legenda dibingkai
  sebagai cerita yang beredar tanpa menyalahkan kelompok nyata; fiksi diperlakukan sebagai fiksi. `factsToVerify`
  tampil di langkah Naskah hanya untuk isi faktual.
- **Narasi utuh dulu.** Tiap bab ditulis sebagai narasi satu kalimat per baris, dengan kalimat pendek yang mudah
  dibacakan. `styleCheck.ts` memeriksa tiap bab:
  - jumlah kata ragu;
  - kalimat yang terlalu panjang;
  - kata yang terlalu sering diulang. Batasnya dihitung per ±150 kata, dan kata dari judul, pertanyaan, judul bab,
    serta detail kunci dikecualikan;
  - sapaan "kamu", hanya di bab pembuka;
  - baris yang berisi lebih dari satu kalimat. Masalah ini kecil, jadi tidak memicu penulisan ulang sendirian.

  Hanya bab yang ditandai yang ditulis ulang. Hasil tulis ulang bab pembuka dibuang jika kalimat pembuka sendiri hilang.
- `narrationSplit.ts` mengelompokkan kalimat utuh tanpa mengubah kata. Kalimat tidak dibelah untuk mengejar jumlah
  adegan; bila sasaran tempo tidak cocok dengan batas kalimat, jumlah adegan boleh berbeda.
- Catatan adegan (judul + satu kalimat tentang apa yang tampak di layar) ditulis per 40 adegan. Catatan menerima
  sinopsis asli dan judul bab, lalu menjadi sumber rencana visual.
- **Pemeriksaan kesetiaan** membaca sinopsis asli, pertanyaan, outline bab, detail kunci, penutup, hal yang dihindari,
  dan daftar fakta. Paling banyak 8 adegan ditulis ulang lewat `rewriteScene`. Jika panggilan pemeriksaan gagal, naskah
  tetap disimpan.
- Proyek lama tetap bisa dibuka. Saat naskah ditulis, `normalizeStoryPlan` memetakan brief dan hook lama ke plan baru;
  hook lama menjadi `customOpening`, dan gaya diturunkan dari brief (cerita rakyat → Horor, fiksi → Cerita fiksi,
  dokumenter → Dokumenter, sisanya Edukasi santai). Brief lama tetap dipakai, tetapi sifat isi dan hal yang dihindari
  mengikuti hasil editan di kerangka. Plan baru tidak menyimpan brief; brief diturunkan ulang dari kerangka setiap kali
  naskah ditulis. Tidak ada migrasi database.
- Panjang narasi mengikuti jatah durasi adegan. Narasi boleh memakai tag ekspresi berbahasa Inggris (`<short pause>`,
  `<long pause>`, `<chuckles>`, `<sigh>`, `<gasp>`, `<whispers>`), paling banyak satu per 40 kata. Daftar tag: `VOICE_TAGS` di `shared/speech.ts`.
- Hasil disimpan dengan `replaceScript`. Durasi awal tiap klip diperkirakan dari jumlah kata
  (`estimateNarrationMs`: sekitar 2,6 kata per detik).

Tahap yang sudah selesai (narasi per babak dan catatan per kelompok) disimpan di memori. Jika satu panggilan
gagal, percobaan berikutnya melanjutkan dari situ selama aplikasi masih terbuka dan rencana tidak berubah.

Di langkah **Naskah** pengguna boleh mengubah, menambah, menghapus, dan mengurutkan adegan.
Setiap adegan juga bisa direvisi dengan instruksi singkat. Revisi hanya mengganti alur dan narasi adegan tersebut;
visual ditandai perlu diperbarui bila alurnya berubah, dan suara lama ditandai perlu dibuat ulang bila narasinya berubah.

## 2. Naskah → rencana visual (`generateVisuals`)

Skema JSON keluaran:

```
world                         satu kalimat dunia cerita (tempat, era, teknologi, siapa orangnya)
characters[]                  { name, identity (tubuh/wajah, tanpa baju), outfit (baju bawaan) }
scenes[]                      { scene, setting, action, wardrobe[{name, source: reference|custom, outfit}],
                                framing, avoid, characters[], camera, strength, motion, transition }
```

Aturan penting di system prompt (dibuat setelah gambar keluar tidak sesuai cerita):

1. Setiap adegan berdiri sendiri: dunia/planet/era selalu disebut, karena model gambar tidak membaca naskah.
2. Narasi yang umum diubah jadi momen konkret yang bisa digambar.
3. Orang disebut "human"; kata yang bisa dibaca sebagai makhluk fantasi ("Martian", "alien", "-born") dilarang.
4. Baju harus cocok dengan tempatnya; "custom" untuk baju khusus adegan, "reference" untuk baju bawaan pemeran.

`visualText()` menyusun prompt berlabel yang disimpan di `clip.visualPrompt` dan bisa diedit pengguna:

```
Setting: ...
Action: ...
Wardrobe: Leo - custom for this scene: light-blue scrubs; the teenager - custom for this scene: grey tunic
Framing: ...
Avoid: Earth landscape, aliens, spacesuits indoors
```

Untuk proyek panjang, rencana visual dibagi menjadi kelompok 20 adegan. Ringkasan cerita penuh, naskah lokal, dan
adegan tetangga disertakan agar konteks prompt cukup tanpa mengirim seluruh naskah berulang kali. Karakter yang
dikenali pada kelompok sebelumnya ikut diteruskan. Progres dilaporkan per kelompok.

Mode `missing` hanya menyusun adegan yang naskahnya berubah sejak rencana terakhir (`needsVisual`); mode `all`
menyusun ulang semuanya. Pemeran lama tidak ditimpa; pemeran baru ditambahkan berdasarkan nama.

## 3. Gambar, lembar karakter, video (`src/main/generation.ts`)

- **Lembar karakter** (`sheetPrompt`): gaya + deskripsi pemeran, tampak depan/tiga perempat/samping, latar polos.
  Dibuat lebih dulu kalau model gambar menerima referensi (`maxRefs(model) > 0`).
- **Gambar klip** (`clipPrompt`): adegan dulu, lalu pemeran (tubuh dari lembar karakter, baju mengikuti baris
  `Wardrobe`), lalu gaya visual, lalu baris `Avoid` sebagai "Must not appear", lalu format frame. Lembar karakter
  dikirim sebagai gambar referensi.
- **Video AI** (`generateClipVideo`): gambar klip + `videoPrompt` (atau prompt cadangan). Setiap prompt video
  diakhiri `NO_MUSIC` ("Silent clip: no background music...") dan audio dimatikan lewat parameter kalau
  modelnya punya (`sound: off`, `generate_audio: false`). Durasi video = durasi terpendek model yang menutup
  panjang klip (`fitDuration`), resolusi dari `project.videoResolution`.
- Hasil diunduh ke folder proyek, dicatat di `assets`, lalu klip diperbarui lewat `patchClip` + `emit.clip`.

Detail API dan katalog model: [layanan-ai.md](layanan-ai.md).

## 4. Narasi (`src/main/narration.ts`)

Suara dibuat **dalam satu rekaman utuh** untuk banyak adegan sekaligus, lalu dipotong per adegan, supaya suara
dan intonasinya konsisten. (Rekaman per klip menghasilkan suara yang sedikit berbeda tiap klip.)

- **Gemini TTS**: adegan digabung dengan `<long pause>` di antaranya, per bagian maksimal sekitar 240 detik
  (`GEMINI_PART_SEC`).
- **ElevenLabs**: per bagian maksimal 2.400 karakter (`ELEVEN_PART_CHARS`), dengan `previous_text`/`next_text`
  agar intonasi bersambung. Waktu per kata datang dari API (alignment).
- **Titik potong antar-adegan**:
  - dengan Whisper: `cutsFromWords` (`cuts.ts`) memotong di jeda yang tumpang-tindih dengan celah antara kata
    terakhir satu adegan dan kata pertama adegan berikutnya, tidak pernah di tengah kata;
  - tanpa Whisper: `chooseCuts`, pemrograman dinamis atas jeda dari `silencedetect` FFmpeg dan perkiraan posisi
    dari panjang teks.
- Setiap potongan disimpan sebagai WAV dengan `meta.words`, dan durasi klip diatur ke panjang potongannya.
  Potongan suara (`voiceInMs` dll.) direset.

### Suara pembicara per adegan

`clip.speakerId` menentukan siapa yang membacakan seluruh narasi/dialog pada adegan itu. `null` berarti suara narator proyek. `characterIds` tetap hanya menjelaskan siapa yang terlihat pada adegan, jadi tokoh yang tampil tidak otomatis menggantikan narator. Suara karakter juga mencatat `ttsProvider`; bila tidak cocok dengan provider proyek, sistem kembali ke narator. Narasi tetap diproses per kelompok suara agar tiap bagian memakai voice yang sesuai, dan konteks sambungan ElevenLabs hanya dikirim untuk bagian yang memakai suara sama.

## 5. Caption akurat (Whisper lokal)

- `src/main/whisper.ts` menjalankan `whisper-cli.exe` dengan model **Whisper Small** (487.601.967 byte, dicek
  SHA-256, diunduh ke `models/whisper`).
- Argumen: `-ml 1 -sow` (satu kata per segmen), `-ojf` (JSON lengkap), `-nfa -dtw small` (waktu kata dari
  DTW). **Tanpa `--prompt`**: prompt berisi naskah membuat Whisper berhalusinasi mengulang kata.
- `align.ts` mencocokkan kata **naskah** ke kata yang didengar Whisper (edit distance). Ejaan caption tetap dari
  naskah; hanya waktunya dari Whisper.
- Berjalan otomatis setelah narasi Gemini (`whisperAuto`), atau manual lewat tab Caption
  (`syncCaptions`, mode `stale`/`all`). Hasil ditandai `meta.timedBy = 'whisper-dtw'`. Narasi Gemini panjang
  diproses per bagian maksimal sekitar 240 detik, dengan progres bagian; Whisper menerima potongan audio tiap
  adegan, bukan satu file gabungan 30 menit.
- Sinkron biasa melewati kata yang diedit manual (`meta.editedWords`) dan menunjukkan jumlah klip yang dilewati.
  Aksi paksa meminta konfirmasi sebelum mengganti edit tersebut.

## 6. Prompt musik (`generateMusicPrompt`)

LLM membuat `{ title, style, exclude, description, reason }` untuk dipakai di Suno, Udio, atau ElevenLabs Music.
Hasilnya disimpan di `editor.musicPrompt`. File musik hasil AI itu lalu dipilih lewat tab Musik.

## Menambah atau mengubah prompt

- Prompt LLM ada di `story.ts`; prompt gambar dan video di `generation.ts`.
- Skema JSON harus memenuhi mode strict OpenAI (semua properti `required`, `additionalProperties: false`) dan
  tetap bisa dipakai Gemini.
- Uji dengan beberapa ide nyata. Kalau model gambar salah tafsir, perbaiki aturan di system prompt (umum),
  jangan menambal satu kasus.
