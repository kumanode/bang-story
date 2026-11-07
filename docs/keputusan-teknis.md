# Keputusan teknis

Catatan kenapa sesuatu dibuat begitu. Sebagian besar lahir dari bug nyata, jadi baca dulu sebelum mengubah
bagian terkait. Tambahkan entri baru di akhir setiap kali membuat keputusan penting.

### Narasi direkam satu kali utuh, lalu dipotong per adegan
TTS yang dipanggil per klip menghasilkan suara dan intonasi yang berbeda-beda. Satu rekaman utuh lalu dipotong
membuat suaranya konsisten. Jangan menambah tombol "buat suara" per klip.

### Whisper tanpa `--prompt`, dengan DTW
Naskah yang dikirim sebagai prompt membuat Whisper berhalusinasi: dalam uji coba, Whisper mengulang "tidak tidak
tidak..." puluhan kali. Caption klip 1 selesai 2 detik lebih cepat dari suaranya, dan kata-kata awal klip lain
tertumpuk di detik 0. Waktu per kata bawaan whisper.cpp juga kurang presisi. Dari tiga cara yang diuji,
`-nfa -dtw small` tanpa prompt paling akurat: caption hanya meleset sekitar 0,1–0,2 detik dari suara (diuji pada
proyek nyata). Ejaan caption tetap dari naskah (`align.ts`); dari Whisper hanya diambil waktunya.

### Potongan adegan mengikuti kata
Dengan Whisper, adegan dipotong di jeda antara kata terakhir satu adegan dan kata pertama adegan berikutnya
(`cutsFromWords`), jadi potongan tidak pernah jatuh di tengah kata. Tanpa waktu kata, `chooseCuts` memilih dari
jeda yang dideteksi FFmpeg. Gemini diberi `<long pause>` di antara adegan supaya jedanya jelas. ElevenLabs
memakai waktu kata dari API-nya sendiri.

### Sorotan caption bertahan di jeda antar kata
Di jeda antar kata, sorotan tetap di kata terakhir yang sudah diucapkan (`captionAt`), sama seperti ekspor.
Dulu sorotan lompat ke kata terakhir baris lalu balik lagi, sehingga terlihat berkedip.

### Segmen ekspor dibulatkan ke frame + 2 frame cadangan
`xfade` menghentikan seluruh video kalau klip pertama habis sebelum offset transisi. Dengan transisi `cut`
(1 frame) dan durasi klip yang tidak pas di frame, gambar video pernah berhenti setelah klip 1 sementara audio
tetap jalan. `planSegments` membulatkan awal klip ke frame utuh dan menambah 2 frame cadangan.

### Gerak kamera di ekspor memakai filter `perspective`, bukan `zoompan`
`zoompan` membulatkan potongan gambar ke piksel bulat setiap frame, sehingga gerak lambat bergoyang 0,6–0,7 px
per frame (terlihat bergetar, terutama garis tipis). `perspective` (sense=source, cubic) bergerak pecahan piksel:
getarannya 0,02–0,16 px dengan kecepatan hampir sama. Gambar diproses di resolusi aslinya (1×–2× output) lalu
diperkecil, supaya tetap tajam. Catatan: penghitung frame `perspective` mulai dari 1, jadi rumusnya memakai `(on-1)`.

### Kotak caption rounded digambar sendiri
libass hanya bisa membuat kotak bersudut siku. Kotak rounded digambar sebagai drawing ASS di layer bawah teks.
Lebarnya dihitung dari metrik file font (`fontMetrics.ts`), dan baris dipecah dengan fungsi yang sama dengan
pratinjau (`layoutCaptionLines`).

### Ukuran caption memakai metrik `cell` per font
libass mengukur ukuran font dengan winAscent+winDescent, CSS dengan em. Tanpa konversi, caption di ekspor hanya
sekitar 57% ukuran pratinjau. Setiap font di `CAPTION_FONTS` punya nilai `cell` hasil pengukuran file TTF-nya.

### Pratinjau menjaga tiga klip tetap terpasang
Membuat elemen `<video>` baru setiap pindah klip sempat menampilkan frame pertama video (atau poster) sebelum
seek. Akibatnya ada kilasan di sambungan potongan dan di transisi. Klip sebelum/sekarang/sesudah selalu
terpasang dalam urutan timeline. Klip berikutnya menunggu di titik mulainya, dan langsung diputar tanpa seek
ulang (seek ulang menahan video sekitar 150 ms).

### Video overlay hardware dimatikan
Di Windows, Chromium menyerahkan video ke overlay hardware (DirectComposition) yang membulatkan posisi dan
ukuran ke piksel bulat. Gerak kamera di atas video jadi gemetar di pratinjau, padahal gambar halus.
Switch `disable-direct-composition-video-overlays` dan opasitas 0,999 untuk video yang bergerak menahan video
di jalur render biasa. (Pemilik aplikasi masih melihat getaran di pratinjau; lihat masalah-diketahui.md.)

### Suara milik klipnya ("klip tertaut")
Seperti suara bawaan klip video di editor lain: suara bisa dipotong dan digeser di dalam klip, dan terpotong di
akhir klip. Ini menjaga sinkron naskah per adegan dan rekam ulang narasi tetap sederhana.

### Potong klip ikut membelah suara dan naskah
Saat klip dibelah, file suara dipotong di jeda antar kata terdekat, dan teks narasinya dibagi
(`splitNarration`). Dengan begitu tiap bagian punya aset dan naskah yang cocok (tidak dianggap basi), dan bisa
direkam ulang sendiri. Bagian pertama diberi transisi `cut` agar sambungannya mulus.

### Panel Transisi, bukan popup
Popup di timeline menutupi pratinjau, padahal pengguna ingin melihat contoh transisinya. Tombol sambungan
membuka panel di kanan, lalu pratinjau memutar sambungan itu berulang-ulang (audition).

### Prompt visual berlabel dan baris Wardrobe
Model gambar tidak membaca naskah. Prompt yang kurang spesifik menghasilkan latar Bumi dan alien untuk cerita di
Mars, dan baju astronot di semua adegan. Setiap prompt kini menyebut dunia/era dengan jelas, orang disebut
"human", dan baju per adegan ditulis di baris `Wardrobe` (bawaan lembar karakter atau custom).

### Prompt video selalu melarang musik
Beberapa model video (Veo, Grok, MiniMax) membuat musik sendiri tanpa saklar. Setiap prompt diakhiri `NO_MUSIC`,
dan audio dimatikan lewat parameter kalau modelnya punya. Audio dari file video tidak pernah dipakai di ekspor.

### Kunci API dienkripsi safeStorage, kunci kripto dibuat saat startup
Kunci kriptografi `safeStorage` baru tertulis ke `Local State` sekitar 10 detik setelah dibuat. Membuatnya saat
startup (`warmUpEncryption`) mencegah kunci API tidak terbaca setelah aplikasi ditutup paksa.

### YouTube embed diberi Referer berisi ID aplikasi
Halaman dari `file://` tidak mengirim Referer, dan YouTube menolak embed tanpa identitas (Error 153). Header
ditambahkan hanya untuk `https://www.youtube.com/embed/*`.

### Hasil job AI di-rebase ke riwayat undo
Undo menyimpan edit pengguna, sedangkan gambar/video/suara yang selesai dibuat di latar bukan edit yang bisa
dibatalkan. Patch hasil job dan aset barunya dimasukkan ke semua snapshot undo/redo agar undo edit lama tidak
menghapus hasil AI. Penggantian media lokal lewat event main mengikuti aturan yang sama.

### Pembicara disimpan terpisah dari pemeran yang terlihat
`characterIds` dibutuhkan untuk prompt visual dan berarti “tampil di adegan”. Memakai field itu untuk suara
mengubah narasi seluruh adegan menjadi suara karakter tanpa indikasi bahwa ia berbicara. `speakerId` kini
menandai dialog/narasi yang dibacakan karakter; kosong berarti narator. ID suara diikat ke `ttsProvider` untuk
mencegah provider menerima ID yang tidak dikenal.

### Caption aktif memakai tata letak yang terkunci
Aturan jarak pop, padding kapsul, radius, dan durasi animasi berada di `shared/captions.ts` agar pratinjau dan
ekspor memakai nilai yang sama. Spasi di pratinjau menjadi node tersendiri di antara span kata; spasi di dalam
`inline-block` dengan `white-space: nowrap` dapat dibuang browser.

Kata aktif di ekspor digambar sebagai event ASS tersendiri di posisi tengah kata. Teks dasar tetap menempati lebar
normal, sehingga perubahan skala kata aktif tidak menata ulang atau menggeser satu baris. Di baris dasar kata aktif
hanya dibuat transparan (`\alpha&HFF&` lalu `\r`), bukan dihapus: tanpa teksnya, baris dasar kosong dan hanya kata
aktif yang tampil. Kapsul digambar sebagai rounded rectangle ASS (`\p1`) di layer bawah, berpusat di kata dan ikut
membesar bersamanya, memakai ukuran dan padding yang sama dengan pratinjau. Di pratinjau kapsul adalah elemen
`absolute` di belakang kata, bukan padding, supaya lebar baris tidak berubah setiap kata berganti. Pop masuk
dianimasikan selama 80 ms dari skala dasar ke 115%; hitungan pratinjau bergantung pada waktu playhead, sehingga
seek dan scrub menghasilkan posisi yang sama.

Glow (Merah Darah, Bisikan Arwah, Api Ritual) adalah event ASS terpisah di layer 0: hanya outline kata aktif yang
di-blur, teksnya transparan. Kalau glow ditulis di baris caption yang sama, outline gelap kata aktif ikut berubah
warna glow dan kata merah di dalam pendaran merah tidak terbaca. Pratinjau menirunya dengan `text-shadow` di
belakang outline gelap.

### Filter warna tetap memiliki selisih ruang warna
CSS memakai RGB, sedangkan sebagian proses FFmpeg memakai YUV. Brightness FFmpeg memakai LUT RGB multiplikatif
agar mendekati `brightness()` CSS, dan urutan sepia/hue disamakan. Konversi ruang warna tetap dapat menghasilkan
perbedaan kecil, terutama pada gradasi kuat.

### Cerita panjang dipecah menjadi kelompok
Durasi 15–30 menit memakai target sekitar 8 detik per adegan, dengan batas 230 adegan. Naskah di atas 60 adegan
ditulis dalam kelompok maksimal 30 adegan dari kerangka yang sudah ditinjau; naskah durasi lebih pendek juga
mengikuti kerangka babak yang sama. Rencana visual dibuat per kelompok 20 adegan. Progres
setiap kelompok dikirim ke UI. Hasil kelompok naskah yang selesai disimpan sementara di memori proses untuk
mencoba ulang kelompok yang gagal selama aplikasi tetap terbuka. Visual yang sudah diterapkan ke proyek tersimpan
per kelompok dan tidak dibuat ulang pada mode adegan yang belum lengkap.

### Render ekspor bertahap dan dapat dilanjutkan
Ekspor membuat segmen per klip, menggabungkannya ke blok video 20 klip dengan overlap transisi di batas blok,
mencampur audio per jendela 30 detik, lalu menggabungkan hasil antara sebelum pass MP4 final. Encoder NVENC
tersedia hanya setelah tes encode singkat berhasil; kegagalan NVENC pada render blok atau final mengulang tahap
tersebut dengan CPU. Berkas antara segmen disimpan di cache proyek berdasarkan isi klip, aset, dan opsi render,
lalu dibersihkan setelah ekspor sukses atau proyek dihapus. Pemeriksaan ruang kosong mencakup output dan
perkiraan berkas kerja sementara.

Blok tengah berhenti tepat setelah transisi ke klip terakhirnya (`own` klip-klip sebelumnya + `overlap` transisi
itu), dan blok berikutnya mulai dari klip yang sama setelah `overlap` tersebut. Kalau blok tengah ikut memuat
seluruh klip bersama itu, klip tampil dua kali dan video tertinggal dari audio di setiap batas blok. Proyek demo
hanya 4 klip (satu blok), jadi uji ekspor blok memakai proyek dengan lebih dari 20 klip.

Tiap jendela audio dicampur mulai 3 detik lebih awal lalu bagian itu dibuang, sehingga kompresor ducking dan fade
musik melanjutkan keadaan jendela sebelumnya. Delay memakai satuan sampel (`adelay=…S`) agar suara yang terbelah dua
jendela tersambung tanpa celah.

### Sinkron Whisper melindungi edit kata manual
Klip dengan `meta.editedWords` dilewati saat sinkron caption biasa. UI menunjukkan jumlah klip yang dilindungi;
aksi paksa meminta konfirmasi dan menghapus penanda edit manual sebelum menulis kata hasil sinkron.

### Alur hook lama dipertahankan untuk proyek tersimpan
Hook adalah janji cerita, bukan kalimat promosi yang berdiri sendiri. Kreator memilih atau menulis hook terlebih
dahulu, meninjau kerangka babak yang menjawabnya, lalu naskah dibuat dari kerangka itu. Revisi adegan membawa hook
dan konteks tetangganya agar perubahan lokal tetap cocok dengan alur utama.

### Kerangka bab baru membaca sinopsis langsung
Untuk proyek baru, satu permintaan LLM menghasilkan pertanyaan, pembuka, isi bab, detail kunci, penutup, hal yang
dihindari, sifat isi, dan fakta yang perlu dicek. Tahap brief dan hook yang terpisah berulang kali meringkas sinopsis
dan dapat menggeser maksud kreator. Plan lama tidak dimigrasikan; brief dan hook lama dinormalisasi saat penulisan,
dengan hook lama menjadi kalimat pembuka yang dipertahankan.

### Profil gaya menyimpan aturan, bukan contoh
Contoh narasi dikirim sekali ke LLM untuk diringkas menjadi aturan ritme dan teknik. Hanya aturan serta nama profil yang
disimpan di settings. Prompt naskah berikutnya memakai aturan hasil ekstraksi, bukan kalimat contoh, agar isi contoh
tidak terbawa atau disalin ke cerita lain.

### Adegan mengikuti kalimat utuh
Jumlah adegan dalam outline adalah sasaran tempo. Narasi satu rekaman dipotong pada batas kalimat dan kalimat panjang
tetap utuh; bila batas alami tidak cocok dengan target, jumlah adegan boleh berbeda. Jangan membelah kalimat secara
otomatis karena potongan itu dapat merusak intonasi dan membuat naskah terputus saat dibacakan.

### Retry Flow2API berhenti saat hasil ambigu
Penolakan HTTP 429/503 sebelum stream adalah satu-satunya kondisi generasi yang dicoba ulang otomatis. Setelah stream
dimulai, koneksi yang putus bisa berarti server sudah menerima dan membuat hasil; permintaan tidak boleh dikirim ulang
diam-diam tanpa idempotensi atau pemeriksaan status yang didukung server.
