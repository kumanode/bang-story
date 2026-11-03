# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/),
dan nomor versi mengikuti [Semantic Versioning](https://semver.org/lang/id/): **mayor** untuk perubahan yang merusak
data atau alur lama, **minor** untuk fitur baru, **patch** untuk perbaikan.

Cara menaikkan versi ada di [docs/pengembangan.md](docs/pengembangan.md#versi-dan-rilis).

## [Belum dirilis]

### Ditambahkan
- Pembicara karakter per adegan dengan fallback ke narator bila provider TTS berbeda.
- Track SFX dengan impor file drag & drop, pemotongan awal/akhir, volume per efek, snap, dan seleksi hapus.
- Generator tiga variasi thumbnail 16:9 dari prompt konsep YouTube.
- Kunci per track, tombol ekspor di header editor, serta panah untuk melangkah satu frame.
- Pilihan durasi hingga 30 menit, penulisan naskah dan rencana visual per kelompok, serta progres tiap kelompok.
- Opsi encoder NVENC, ekspor video/audio bertahap, pemeriksaan ruang disk, dan cache segmen ekspor yang bisa dipakai ulang.

### Diubah
- Editor timeline dapat diubah ukurannya dengan batas jendela dan kontrol keyboard.
- Undo/redo mempertahankan hasil job AI; geser slider dan item timeline menjadi satu gestur undo.
- Filter, transisi, caption aktif, bab YouTube, dan duplikasi proyek kini memakai data bersama atau pemetaan ID yang konsisten.
- Hasil bab YouTube menggabungkan adegan di bawah 10 detik; video yang terlalu pendek menampilkan peringatan jumlah bab.
- Timeline dan daftar Storyboard memuat item bertahap agar proyek ratusan klip tetap ringan.

### Diperbaiki
- Loop audio pratinjau tidak restart karena array kosong berubah tiap render.
- Outline kapsul kata dan glow caption ekspor terlihat dan direset dengan benar.
- Mute track reset saat proyek berganti; klip lokal divalidasi kepemilikan dan dukungan codec.
- Upload SFX menolak durasi yang tidak terbaca; ukuran overlay reset ke nilai bawaan dalam rentang.
- Spasi caption tetap utuh saat kata aktif membesar; tata letak ekspor tidak bergeser, dan kapsul ekspor memakai bentuk rounded sebenarnya.
- Sinkron Whisper melindungi edit kata manual dengan konfirmasi terpisah untuk menimpanya.
- Ekspor panjang membatasi jumlah input FFmpeg per tahap, memakai ulang segmen yang cocok setelah gagal, dan beralih ke CPU bila NVENC gagal.

## [1.0.0] - 2026-10-02

Rilis pertama Bang Story (sebelumnya bernama Studio Cerita).

### Alur produksi
- Empat langkah: **Ide cerita → Naskah → Storyboard → Editor**, tersimpan otomatis di database lokal.
- Penyusun cerita memakai Gemini, OpenRouter, Groq, atau endpoint custom yang kompatibel dengan OpenAI. Daftar
  modelnya diambil langsung dari penyedia.
- Naskah bisa diubah, ditambah, dihapus, dan diurutkan ulang. Narasi boleh memuat tag ekspresi suara.
- Rencana visual dibuat dari naskah final: prompt gambar berlabel (dunia dan era, aksi, baju per adegan, hal yang
  harus dihindari), pemeran beserta lembar karakter, gerak kamera, transisi, dan arahan gerak video.
- 14 model gambar dan 34 model video Higgsfield, dengan perkiraan kredit dari endpoint `estimate`. Resolusi video
  bisa dipilih per proyek.
- Narasi dibuat dalam satu rekaman utuh (Gemini TTS atau ElevenLabs), lalu dipotong otomatis per adegan.
- Caption akurat dengan Whisper lokal (mode DTW). Klip lama bisa disinkronkan ulang dari tab Caption.
- Panel Musik bisa membuat prompt musik latar untuk Suno atau AI musik lain.

### Editor
- Pratinjau langsung dengan gerak kamera, transisi, caption karaoke, musik latar, dan overlay (logo, watermark,
  teks) yang bisa digeser di pratinjau.
- Timeline seperti editor video:
  - tarik tepi klip untuk mengatur panjangnya (video tidak bisa melebihi panjang aslinya);
  - geser dan potong suara, caption, musik, dan overlay;
  - **Potong** (S atau Ctrl+B) dan **Hapus** (Delete);
  - snap ke playhead dan sambungan;
  - overlay bertumpuk di baris masing-masing.
- Transisi diatur per sambungan dari tombol di antara klip. Panelnya punya pratinjau yang diputar berulang, durasi
  0,2–2 detik, dan tombol terapkan ke semua.
- Gerak kamera bisa diatur untuk klip gambar maupun video. Pratinjaunya diputar tanpa menggeser playhead.
- Caption:
  - 4 gaya dan pilihan tanpa caption;
  - 15 font (4 tegas, 9 kartun/komik, 2 tulisan tangan/elegan) dengan contoh di daftar;
  - ukuran, posisi, warna, dan kotak latar rounded;
  - teksnya bisa diedit langsung dan tersimpan otomatis.
- Suara: volume per klip dan volume narasi. Musik: volume, otomatis mengecil saat narasi, dipotong, dan digeser.

### Ekspor
- MP4 dirender dengan FFmpeg di komputer pengguna. Hasilnya sama dengan pratinjau karena aturan gerak, transisi,
  caption, dan potongan suara dipakai bersama (`src/shared/`).
- Gerak kamera halus memakai filter `perspective`. Caption memakai libass dengan kotak rounded, dan ukurannya
  sama dengan pratinjau.
- Proyek bisa diekspor berulang kali setelah diedit.

### Lainnya
- Kunci API milik pengguna (BYOK), disimpan terenkripsi dengan DPAPI Windows (`safeStorage`).
- Halaman About menampilkan versi aplikasi, tautan ke channel Bang Tutorial, dan video tutorial.
- Salinan siap jalan dengan skrip START untuk Windows dan macOS.
- Dokumentasi pengembang: [AGENTS.md](AGENTS.md) dan folder [docs/](docs/README.md).
- Kode dirilis dengan [lisensi MIT](LICENSE). README dilengkapi badge dan screenshot.
- Installer Windows (`BangStory-Setup-1.0.0.exe`) dengan ikon dari logo Bang Story.

### Batasan yang diketahui
Lihat [docs/masalah-diketahui.md](docs/masalah-diketahui.md). Yang paling terasa:
- gerak kamera di atas video masih bergetar di pratinjau (hasil ekspor halus);
- belum ada undo/redo;
- Whisper dan installer baru tersedia untuk Windows.
