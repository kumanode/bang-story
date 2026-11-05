# Rencana Implementasi: Hook, Narasi, Flow2API, dan Higgsfield

## Ringkasan

Meningkatkan kualitas hook dan narasi, serta throughput dan keandalan generate gambar/video melalui Flow2API dan Higgsfield. Perubahan mencakup pembukaan cerita yang menyatu, pembagian narasi berdasarkan beat, peninjauan/revisi adegan, batas paralel provider yang dapat diatur, pengiriman gambar referensi yang benar, progres yang jujur, retry yang aman, dan pengukuran sebelum/sesudah.

## Keputusan desain

- Batas paralel Flow2API dan Higgsfield diatur terpisah. Antrean TTS, Whisper, dan ekspor tidak berubah.
- Konkurensi provider dapat diatur pengguna dalam batas aman. Nilai awal tetap konservatif sampai hasil pengukuran pada server/akun nyata membuktikan nilai yang lebih tinggi aman; jangan menganggap kapasitas setiap provider sama.
- Aset sumber di disk tidak diubah. Optimasi referensi hanya membuat representasi sementara untuk permintaan Flow2API, menjaga rasio aspek, dan harus diuji terhadap hasil karakter.
- Data URI memakai MIME yang sesuai dengan byte gambar. Format yang tidak didukung harus dikonversi memakai fasilitas yang sudah ada atau ditolak dengan pesan jelas.
- Retry otomatis hanya untuk kegagalan yang diketahui terjadi sebelum permintaan diterima, atau untuk error eksplisit yang aman diulang. Putus koneksi saat streaming dianggap hasil tidak pasti agar tidak diam-diam memulai generasi dan biaya duplikat.
- UI tidak menampilkan persentase kemajuan palsu. Tampilkan fase dan waktu berjalan; persentase hanya ditampilkan jika Flow2API benar-benar menyediakannya.
- Hook, kerangka cerita, dan revisi adegan sudah tersedia dalam alur saat ini; pekerjaan narasi memperbaiki kualitas integrasi dan batas adegannya, bukan membangun ulang fitur yang sudah ada.
- Pengukuran memisahkan waktu antre, generasi remote, unduh, dan pemrosesan lokal. Menaikkan paralelisme mempercepat batch bila provider mampu, tetapi tidak menjamin satu gambar selesai lebih cepat.
- Tidak menambah kolom database klip. Jika pencatatan durasi perlu disimpan, gunakan skema job/settings yang sudah ada atau putuskan migrasi terpisah setelah audit data model.

## Daftar tugas

### Fase 1: Baseline dan kontrak konfigurasi

- [ ] **Tugas 1 — Petakan konfigurasi dan ambil baseline kedua provider.** Catat provider/model/resolusi, waktu antre, waktu generasi remote, unduh, ukuran/jumlah referensi, jumlah retry, serta mutu hasil pada serangkaian adegan yang sama untuk Flow2API dan Higgsfield. Pastikan log tidak menyimpan API key, data Base64, atau prompt sensitif. Dokumentasikan versi/server/akun dan limit yang tersedia bila diketahui.
  - Kriteria selesai: baseline per provider/model dapat dibandingkan; tiap durasi fase didefinisikan; limit provider tidak diasumsikan dari versi lain.
  - Verifikasi: jalankan generate manual pada proyek uji yang sama dan catat waktu serta mutu; jangan memakai kredensial/proyek produksi untuk eksperimen.
  - Berkas kemungkinan: `src/main/services/flow2api.ts`, `src/main/services/higgsfield.ts`, `src/main/jobs.ts`, `docs/layanan-ai.md`.
  - Ketergantungan: tidak ada.

- [ ] **Tugas 2 — Tambahkan pengaturan konkurensi terpisah untuk Flow2API dan Higgsfield.** Perluas tipe Settings, nilai default/validasi, antrean `runJob`, dan UI Pengaturan. Sediakan rentang yang eksplisit untuk tiap provider dan jelaskan bahwa nilai mengatur jumlah pekerjaan bersamaan. Pertahankan limit awal sampai benchmark mendukung perubahan.
  - Kriteria selesai: perubahan nilai memengaruhi pekerjaan baru; nilai invalid ditolak/dibatasi; antrean TTS/Whisper/ekspor tidak berubah; nilai bertahan setelah aplikasi dimulai ulang.
  - Verifikasi: ubah nilai tiap provider, restart aplikasi, lalu pastikan limit antrean sesuai; bandingkan waktu total dan pantau rate limit/kegagalan.
  - Berkas kemungkinan: `src/shared/types.ts`, `src/main/settings.ts`, `src/main/jobs.ts`, halaman Pengaturan renderer; IPC/preload hanya jika jalur pengaturan yang ada belum cukup.
  - Ketergantungan: Tugas 1.

### Checkpoint 1

- [ ] Baseline dan batas pengaturan disepakati berdasarkan kemampuan server uji.
- [ ] Pengaturan kedua provider terpisah; antrean TTS/Whisper/ekspor tidak berubah; typecheck/build bersih.

### Fase 2: Referensi gambar yang benar dan efisien

- [ ] **Tugas 3 — Cocokkan MIME gambar referensi dengan byte aslinya.** Buat satu jalur utilitas untuk mengenali MIME berdasarkan isi/format aset, lalu gunakan untuk referensi karakter gambar dan frame awal video. Tangani PNG/JPEG/WebP sesuai dukungan endpoint; untuk format lain, konversi atau beri error yang dapat ditindaklanjuti.
  - Kriteria selesai: tidak ada lagi asumsi bahwa semua buffer adalah PNG; gambar PNG/JPEG/WebP tervalidasi pada dua jalur (image-to-image dan image-to-video); file aset lokal tetap tidak berubah.
  - Verifikasi: gunakan fixture atau aset uji tiap format, pastikan data URI dan hasil server benar, serta pastikan pesan error jelas untuk format yang tidak didukung.
  - Berkas kemungkinan: `src/main/services/flow2api.ts`, `src/main/generation.ts`, utilitas gambar yang sudah tersedia atau utilitas baru di `src/main/`.
  - Ketergantungan: Tugas 1.

- [ ] **Tugas 4 — Kurangi payload referensi secara aman bila baseline menunjukkan perlu.** Audit ukuran dan resolusi sheet/frame. Jika unggahan menjadi bottleneck, buat salinan sementara dengan batas dimensi/ukuran yang terukur, menjaga rasio aspek dan keterbacaan karakter. Gunakan library atau FFmpeg yang sudah tersedia sebelum menambah dependensi; jangan mengompres semua aset tanpa ambang.
  - Kriteria selesai: aset asli tidak berubah; salinan hanya dibuat saat melewati ambang; log menunjukkan ukuran sebelum/sesudah tanpa merekam isi gambar; uji visual memastikan identitas karakter tidak memburuk.
  - Verifikasi: bandingkan waktu unggah dan hasil gambar pada fixture referensi yang sama, termasuk referensi besar dan kecil. Jika tidak ada peningkatan terukur atau kualitas turun, batalkan optimasi ukuran dan pertahankan perbaikan MIME saja.
  - Berkas kemungkinan: `src/main/services/flow2api.ts`, `src/main/generation.ts`, utilitas gambar.
  - Ketergantungan: Tugas 1 dan Tugas 3.

### Checkpoint 2

- [ ] Referensi PNG/JPEG/WebP terbaca benar pada endpoint Flow2API yang digunakan.
- [ ] Optimasi payload hanya dilanjutkan jika memberi peningkatan terukur tanpa penurunan visual.

### Fase 3: Retry, progres, dan diagnosis

- [ ] **Tugas 5 — Buat kebijakan retry aman.** Klasifikasikan error HTTP dan putus koneksi. Hormati `Retry-After` bila tersedia, gunakan backoff dengan jitter yang dapat dibatalkan, dan jangan kirim ulang otomatis setelah stream berjalan jika status generasi tidak dapat dipastikan. Jelaskan pada pengguna bahwa hasil mungkin belum diketahui dan sediakan tindakan coba lagi manual.
  - Kriteria selesai: 429/503 sebelum stream dapat mencoba ulang sesuai kebijakan; pembatalan pengguna menghentikan jeda/retry; stream terputus setelah mulai tidak memulai permintaan duplikat tanpa mekanisme idempotensi/status yang didukung server; error dan jumlah percobaan terlihat jelas.
  - Verifikasi: simulasi/test manual untuk 429 dengan dan tanpa `Retry-After`, 503, timeout sebelum respons, putus stream setelah respons mulai, respons kosong, dan pembatalan.
  - Berkas kemungkinan: `src/main/services/flow2api.ts`, helper error Flow2API.
  - Ketergantungan: Tugas 1.

- [ ] **Tugas 6 — Tampilkan progres berdasarkan fase dan ukur durasi kedua provider.** Pisahkan antre, mengirim, menunggu/generasi, mengunduh, dan selesai. Untuk Flow2API, hilangkan kurva persentase berbasis asumsi waktu; tampilkan status dan waktu berjalan ketika server tidak memberi persentase nyata. Untuk Higgsfield, pertahankan status remote yang benar dan catat waktu polling/generasi. Jangan simpan key, Base64, atau isi prompt dalam diagnosis.
  - Kriteria selesai: UI tidak memberi kesan persentase akurat jika provider tidak mengirimnya; durasi antre/generate/unduh dapat dibandingkan; pencatatan tidak membocorkan rahasia.
  - Verifikasi: pantau job lambat, cepat, gagal, dan dibatalkan di kedua provider; pastikan event IPC status dan antrean provider lain tidak terganggu.
  - Berkas kemungkinan: `src/main/services/flow2api.ts`, `src/main/services/higgsfield.ts`, `src/main/jobs.ts`, tipe/event job, komponen UI job/progress, dokumentasi layanan AI.
  - Ketergantungan: Tugas 1 dan Tugas 5.

### Checkpoint 3

- [ ] Gangguan jaringan tidak memicu pengulangan generasi tersembunyi.
- [ ] Progres dan diagnosis cukup untuk membedakan waktu antre, generasi, dan unduhan.
- [ ] Tidak ada rahasia atau data gambar/prompt yang masuk ke log.

### Fase 4: Evaluasi dan penyelesaian

- [ ] **Tugas 7 — Bandingkan hasil Flow2API dan dokumentasikan batasnya.** Ulangi baseline pada kondisi yang sama. Tetapkan rekomendasi konkurensi berdasarkan waktu total, retry, rate limit, serta mutu visual. Perbarui dokumentasi pengaturan dan pemecahan masalah.
  - Kriteria selesai: hasil sebelum/sesudah Flow2API tercatat; nilai rekomendasi punya bukti; dokumentasi menyebut kapasitas tergantung server/token/model.
  - Verifikasi: uji koneksi, batch gambar, referensi karakter, image-to-video, kegagalan, retry, dan pembatalan pada server uji.
  - Berkas kemungkinan: `docs/layanan-ai.md`, file implementasi terkait.
  - Ketergantungan: Tugas 1–6.

### Fase 5: Hook dan narasi yang lebih natural

- [ ] **Tugas 8 — Perbaiki penyatuan hook dengan paragraf pembuka.** Audit pilihan hook manual/otomatis yang sudah ada dan pertahankan alur pemilihan pengguna. Hapus perilaku yang sekadar menempelkan hook jika naskah tidak diawali teks hook persis; arahkan generator agar memakai hook terpilih sebagai kalimat pembuka, lalu validasi bahwa pembuka menyambung ke cerita tanpa mengulang gagasan.
  - Kriteria selesai: hook tidak muncul dua kali atau terasa ditempel; pembuka tetap relevan dengan isi dan payoff; hook manual pengguna tidak ditimpa.
  - Verifikasi: uji hook manual dan otomatis pada cerita fiksi, faktual, daftar, dan explainer; tinjau pembukaan lengkap, bukan hook terpisah.
  - Berkas kemungkinan: `src/main/story.ts`, alur Hook/Idea/Script renderer, prompt/schema terkait.
  - Ketergantungan: tidak ada.

- [ ] **Tugas 9 — Susun narasi berdasarkan beat dan jaga batas adegan.** Gunakan outline/beat yang dapat ditinjau sebagai panduan untuk menyusun momen cerita; hindari membagi teks secara mekanis hanya demi jumlah adegan. Jika jumlah adegan target tidak cocok dengan batas kalimat, izinkan jumlah/tempo adegan menyesuaikan atau minta penulisan ulang yang alami; jangan memotong kalimat menjadi fragmen tanpa kontrol.
  - Kriteria selesai: tiap adegan punya satu fungsi/momen yang jelas; transisi sebab-akibat tetap tersambung; pemotongan tengah kalimat terhindari kecuali memang disengaja; narasi utuh tetap dapat dipakai untuk TTS satu rekaman.
  - Verifikasi: uji naskah panjang dan pendek, target adegan rapat, serta kalimat panjang; tinjau gabungan naskah dan batas tiap adegan.
  - Berkas kemungkinan: `src/main/story.ts`, `src/main/narrationSplit.ts`, `src/shared/types.ts`, UI storyboard/script yang sudah ada.
  - Ketergantungan: Tugas 8.

- [ ] **Tugas 10 — Perkuat pemeriksaan mutu dan revisi bagian tertentu.** Audit fitur review naskah dan revisi adegan yang sudah ada. Tambahkan kriteria untuk bahasa Indonesia lisan yang natural, pembuka tidak berulang, hubungan antaradegan, kontinuitas hook ke payoff, dan kesesuaian outline dengan isi. Pastikan revisi satu bagian menerima konteks tetangga dan tidak mengubah bagian lain.
  - Kriteria selesai: review memberi temuan spesifik yang bisa ditindaklanjuti, tidak menulis ulang seluruh naskah tanpa diminta, dan revisi lokal mempertahankan fakta/brief serta alur sebelum-sesudah.
  - Verifikasi: uji contoh pembuka kaku, pengulangan, transisi mengambang, serta revisi satu adegan; pastikan bagian lain tetap sama.
  - Berkas kemungkinan: `src/main/story.ts`, komponen review/revisi storyboard renderer, tipe/API hanya jika kontrak yang ada kurang.
  - Ketergantungan: Tugas 8 dan 9.

### Checkpoint 4

- [ ] Hook, outline yang ditinjau, dan revisi lokal tetap tersedia; pembuka dan batas adegan terasa natural pada naskah contoh.
- [ ] TTS satu rekaman dan sinkronisasi adegan/caption tidak mengalami regresi.

### Fase 6: Performa dan mutu visual Higgsfield

- [ ] **Tugas 11 — Optimalkan throughput antrean Higgsfield berdasarkan pengukuran.** Gunakan baseline Tugas 1 untuk membedakan waktu antre, polling, generasi, unduh, dan proses lokal. Uji kenaikan concurrency bertahap melalui pengaturan Tugas 2; evaluasi penggunaan ulang dan deduplikasi upload referensi hanya bila itu terbukti menjadi bottleneck. Jangan mempercepat polling secara agresif tanpa mempertimbangkan batas API.
  - Kriteria selesai: rekomendasi concurrency Higgsfield didukung hasil pada akun/model uji; rate limit/kegagalan tidak meningkat melewati ambang yang ditetapkan; job Flow2API tidak terpengaruh.
  - Verifikasi: bandingkan batch gambar yang sama pada limit saat ini dan nilai bertahap; catat waktu total, waktu antre, error, dan unduhan.
  - Berkas kemungkinan: `src/main/jobs.ts`, `src/main/generation.ts`, `src/main/services/higgsfield.ts`, alur referensi di `src/main/generation.ts`.
  - Ketergantungan: Tugas 1 dan 2.

- [ ] **Tugas 12 — Tambahkan pilihan Draft/Final untuk resolusi gambar jika model mendukung.** Audit resolusi yang dipilih otomatis dan kontrol resolusi yang sudah tersedia. Sediakan cara cepat membuat draft beresolusi lebih rendah untuk menilai komposisi, lalu gunakan resolusi final hanya pada gambar terpilih. Jangan mengklaim lebih cepat sebelum benchmark mengonfirmasi.
  - Kriteria selesai: mode Draft hanya memilih opsi yang didukung model; Final mempertahankan kualitas penuh; setelan video dan kesamaan preview/ekspor tidak berubah; model/resolusi tercatat di aset.
  - Verifikasi: bandingkan waktu, ukuran file, ketajaman saat zoom/pan, dan hasil ekspor pada model yang sama; uji model yang tidak mendukung pilihan resolusi.
  - Berkas kemungkinan: `src/shared/higgsfield.ts`, katalog model, komponen pemilih model/resolusi, tipe proyek/settings hanya jika persistensi diperlukan.
  - Ketergantungan: Tugas 1.

- [ ] **Tugas 13 — Tampilkan tombol Batalkan saat video sedang dibuat.** Di panel Storyboard seperti pada screenshot, tampilkan tombol `Batalkan` di samping `Buat video` hanya saat job video klip itu berstatus antre atau berjalan. Hubungkan ke `window.api.generate.cancel(videoJob.id)` yang sudah tersedia; pertahankan indikator progres dan cegah pembatalan pada job klip lain. Periksa juga tombol video di Inspector agar perilakunya konsisten bila alur itu digunakan.
  - Kriteria selesai: tombol muncul hanya selama job video aktif, membatalkan job yang benar, lalu UI menampilkan status batal dan memungkinkan pengguna mencoba lagi; tombol tidak tampil untuk job selesai/gagal.
  - Verifikasi: batalkan saat antre, saat generate Higgsfield berjalan, dan saat Flow2API stream berjalan; pastikan status job benar dan aset yang terlambat datang tidak menimpa status/hasil baru. Pastikan aksi tidak membatalkan generate gambar atau klip lain.
  - Berkas kemungkinan: `src/renderer/src/pages/project/StoryboardStep.tsx`, `src/renderer/src/pages/project/editor/Inspector.tsx`, `src/main/jobs.ts`, `src/main/services/higgsfield.ts` hanya jika audit menemukan pembatalan remote belum sesuai.
  - Ketergantungan: Tugas 1 dan 2; gunakan API pembatalan yang sudah ada sebelum menambah kontrak IPC.

- [ ] **Tugas 14 — Evaluasi akhir lintas cerita dan provider.** Jalankan skenario end-to-end dengan proyek uji yang sama: buat/ubah hook, tinjau outline, revisi adegan, hasilkan gambar di Flow2API dan Higgsfield, lalu periksa urutan visual, karakter, waktu, retry, pembatalan video, dan batch completion. Dokumentasikan hasil dan batas masing-masing provider.
  - Kriteria selesai: seluruh kriteria kualitas narasi dan provider terpenuhi; hasil sebelum/sesudah tersimpan sebagai catatan; dokumentasi menjelaskan mana yang dipengaruhi aplikasi dan mana yang bergantung pada server/provider.
  - Verifikasi wajib: `npm run typecheck`, `npm run build`, dev harness untuk alur cerita dan generate; gunakan `STUDIO_USER_DATA` sementara. Untuk narasi/preview, periksa isi halaman dan hasil gabungan adegan, bukan screenshot saja.
  - Berkas kemungkinan: dokumentasi layanan AI, pengembangan, alur produksi, serta file implementasi terkait.
  - Ketergantungan: semua tugas sebelumnya.

## Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kapasitas server Flow2API berbeda antar instalasi | Limit lebih tinggi memperbanyak 429/503 atau memperlambat semua tugas | Pengaturan konservatif, rentang terbatas, benchmark bertahap, dan pesan jelas saat server membatasi permintaan |
| Kapasitas Higgsfield berbeda per akun/model | Menambah concurrency memicu antrean atau batas penyedia | Uji bertahap per akun/model; jangan menyamakan kapasitas dengan batas maksimum yang dipublikasikan |
| MIME salah atau format gambar tidak didukung | Referensi karakter/frame diabaikan atau permintaan gagal | Deteksi format dari byte, uji tiga format umum, dan konversi/penolakan eksplisit |
| Retry setelah permintaan diterima | Gambar duplikat, waktu dan kuota terbuang | Jangan retry stream ambigu tanpa idempotensi atau pemeriksaan status dari server |
| Kompresi referensi merusak detail karakter | Konsistensi visual memburuk | Hanya optimalkan jika ukuran menjadi bottleneck; simpan sumber asli dan lakukan perbandingan visual |
| Persentase progres dianggap kemajuan nyata | Pengguna salah memperkirakan waktu selesai | Gunakan fase dan waktu berjalan kecuali server memberi progress aktual |
| Perubahan beat mengubah timing adegan/TTS/caption | Audio dan batas adegan tidak lagi cocok | Pertahankan narasi satu rekaman; verifikasi split, Whisper, caption, serta hasil timeline setelah perubahan |
| Pembatalan lokal tidak menghentikan proses di server Flow2API | Penggunaan kuota bisa berlanjut setelah job UI batal | Jelaskan status pembatalan lokal; gunakan endpoint pembatalan remote hanya jika server yang terpasang menyediakannya |
| Resolusi Draft tidak mempercepat model tertentu | Fitur menambah kompleksitas tanpa manfaat waktu | Ukur per model dan tampilkan sebagai pilihan kualitas; jangan menjanjikan percepatan universal |
| Penambahan setting meluas ke migrasi/IPC yang tidak perlu | Risiko perubahan data atau kontrak berlebihan | Gunakan sistem key/value settings dan IPC yang ada; migrasi hanya jika audit membuktikan wajib |

## Di luar cakupan

- Mengubah API/server Flow2API yang dipasang pengguna.
- Mengganti model penyedia atau menjamin waktu generasi tertentu.
- Mengubah aset sumber atau perilaku preview/ekspor di luar perubahan yang dibutuhkan untuk mode resolusi gambar.
- Menambah dependensi pemrosesan gambar sebelum kebutuhan dan manfaatnya terbukti.
