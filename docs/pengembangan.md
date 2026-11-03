# Pengembangan

## Persiapan

- **Node.js LTS** (dikembangkan dengan Node 22) dan npm.
- Windows 10/11 x64 untuk build installer dan fitur Whisper. Aplikasi bisa jalan di macOS lewat `npm run dev`,
  tapi caption akurat (Whisper) belum tersedia di sana.
- Koneksi internet saat `npm install` (Electron mengunduh programnya sendiri; `ffmpeg-static` mengunduh FFmpeg
  sesuai OS).

```bash
npm install
npm run dev
```

`postinstall` menjalankan `electron-builder install-app-deps`, yang membangun ulang `better-sqlite3` untuk
versi Node milik Electron. Kalau muncul error "was compiled against a different Node.js version", jalankan
`npm install` lagi.

Electron 44 mengunduh programnya saat pertama dipakai. Kalau `node_modules/electron/dist` kosong, jalankan
`node node_modules/electron/install.js`.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | mode pengembangan dengan hot reload renderer (main/preload dibuild ulang saat berubah) |
| `npm run typecheck` | TypeScript untuk main+preload+shared (`tsconfig.node.json`) dan renderer+shared (`tsconfig.web.json`) |
| `npm run build` | build produksi ke `out/` |
| `npm run preview` | jalankan hasil build |
| `npm run dist` | build + installer Windows NSIS ke `dist/BangStory-Setup-<versi>.exe` |

Alias impor: `@shared/*` → `src/shared/*` (semua proses), `@renderer/*` → `src/renderer/src/*`.

## Folder data saat mengembangkan

Mode pengembangan memakai folder data yang sama dengan aplikasi terpasang (`%APPDATA%\Bang Story`). Supaya
proyek dan kunci API asli tidak tersentuh saat bereksperimen, arahkan ke folder lain:

```powershell
$env:STUDIO_USER_DATA = "C:\temp\bangstory-dev"; npm run dev
```

## Variabel lingkungan (hanya saat tidak dipaketkan)

| Variabel | Fungsi |
|---|---|
| `STUDIO_USER_DATA` | folder data alternatif |
| `STUDIO_CAPTURE_PLAN` | path file JSON rencana dev harness (lihat di bawah) |
| `STUDIO_LOG` | file untuk menampung `console` renderer dan error harness |
| `STUDIO_HF_BASE` | base URL Higgsfield tiruan (mock) supaya UI bisa diuji tanpa kredit |
| `STUDIO_WHISPER_URL` | URL model Whisper alternatif (misalnya server lokal) untuk menguji unduhan |

## Dev harness (pengujian otomatis)

Belum ada unit test. Perubahan diuji dengan menjalankan aplikasi sungguhan yang dikendalikan file JSON
(`src/main/devharness.ts`). Harness hanya aktif kalau aplikasi tidak dipaketkan dan `STUDIO_CAPTURE_PLAN` diisi.

```powershell
npm run build
$env:STUDIO_CAPTURE_PLAN = "C:\temp\plan.json"
$env:STUDIO_USER_DATA   = "C:\temp\userdata-uji"
$env:STUDIO_LOG         = "C:\temp\uji.log"
node_modules\electron\dist\electron.exe .
```

`plan.json` berisi langkah berurutan:

```json
[
  { "main": "seed", "wait": 1500 },
  { "main": "speech", "wait": 500 },
  { "js": "location.reload()", "wait": 2500 },
  { "js": "document.querySelector('article button')?.click()", "wait": 3000, "shot": "C:/temp/editor.png" },
  { "drag": { "selector": "div[aria-label^=\"Klip 1 \"]", "at": "right", "dx": 80, "fy": 0.2 }, "wait": 2000 },
  { "key": "Delete", "wait": 800 },
  { "js": "(async () => { const l = await window.api.projects.list(); console.log('CEK ' + l.length) })()", "wait": 500 },
  { "main": "export", "exportTo": "C:/temp/ekspor", "wait": 30000 },
  { "wait": 100, "quit": true }
]
```

| Langkah | Fungsi |
|---|---|
| `main: "seed"` | membuat proyek demo 4 klip dari gambar dan suara sintetis (tanpa API) |
| `main: "speech"` | mengganti suara demo dengan ucapan sungguhan (Windows SAPI) + waktu kata perkiraan |
| `main: "videos"` | memberi semua klip video uji 6 detik (klip 1 diberi zoom kuat) |
| `main: "overlays"` | menambah logo dan teks overlay demo |
| `main: "key"` + `provider`, `ok` | menyimpan kunci palsu dengan status tes lulus/gagal |
| `main: "export"` + `exportTo`, `projectId` | mengekspor proyek demo (atau proyek tertentu) ke folder |
| `js` | menjalankan JavaScript di halaman (boleh `async`); hasil `console.log` masuk ke `STUDIO_LOG` |
| `drag` | seret mouse sungguhan: `selector`, `at` (`left`/`right`/`center`), `dx`, `fy` (posisi vertikal 0–1) |
| `click` | klik mouse sungguhan: `selector`, `fx`, atau `pointJs` (JS yang mengembalikan `{x, y}`) |
| `key` | tekan tombol sungguhan, misalnya `"s"` atau `"Delete"` |
| `wait` | jeda sesudah langkah (ms) |
| `shot` | simpan screenshot jendela ke path PNG |
| `quit` | tutup aplikasi |

Tips:

- **Jangan** memanggil `location.reload()` di dalam fungsi `async` yang ditunggu; buat langkah tersendiri.
- `drag`, `click`, dan `key` memakai input Electron sungguhan (`sendInputEvent`), jadi pointer capture dan
  shortcut keyboard bekerja seperti dipakai manusia. Event buatan JavaScript tidak cukup untuk menyeret.
- Periksa isi halaman lewat `console.log` (misalnya tab aktif, nilai input), bukan hanya screenshot.
- Untuk menguji dengan data proyek asli, salin `studio.db` lewat backup SQLite ke folder uji, **kosongkan tabel
  `secrets`** di salinan, lalu salin folder proyeknya.

## Menguji modul bersama tanpa aplikasi

Modul `src/shared/*` murni TypeScript dan bisa dijalankan di Node:

```bash
npx esbuild src/shared/captions.ts --bundle --platform=node --format=cjs --outfile=tmp/captions.cjs
node -e "const c = require('./tmp/captions.cjs'); console.log(c.chunkWords([{text:'Halo',start:0,end:0.4}]))"
```

Cara ini dipakai untuk menguji pemenggalan caption, sorotan kata, dan getaran gerak kamera (dengan mengukur
posisi titik pada frame hasil FFmpeg).

## Memeriksa hasil ekspor

```bash
# durasi video dan audio harus sama dengan jumlah durasi klip
ffmpeg -i hasil.mp4 -map 0:v -c copy -f null -
ffmpeg -i hasil.mp4 -map 0:a -c copy -f null -
# cuplikan frame di detik tertentu
ffmpeg -ss 3.5 -i hasil.mp4 -frames:v 1 frame.png
```

FFmpeg ada di `node_modules/ffmpeg-static/ffmpeg.exe`. Graph filter terakhir ditulis ke `tmp/export-<id>/graph.txt`
selama ekspor berjalan.

## Debugging

- DevTools renderer: tekan `Ctrl+Shift+I` di mode pengembangan.
- Log proses utama muncul di terminal `npm run dev`.
- Error dari IPC muncul sebagai toast; pesannya berasal dari `throw new Error('...')` di proses utama.

## Versi dan rilis

1. Naikkan versi: `npm version 1.1.0 --no-git-tag-version` (mengubah `package.json` dan `package-lock.json`).
   Halaman About membaca versi dari `app.getVersion()`. Badge versi di `README.md` ditulis manual, jadi ubah juga.
2. Catat perubahan di `CHANGELOG.md`.
3. `npm run typecheck` dan `npm run build`.
4. `npm run dist` → `dist/BangStory-Setup-<versi>.exe`. Build pertama mengunduh alat NSIS dan winCodeSign ke
   cache electron-builder.
5. Buat release di GitHub dengan tag `v<versi>`. Upload hanya file `.exe`. File `.blockmap` dan `latest.yml` baru
   berguna kalau nanti ada fitur update otomatis.

Yang ikut dipaketkan (lihat `electron-builder.yml`): `out/`, FFmpeg (di luar asar), `resources/fonts` → `fonts`,
`resources/whisper` → `whisper`, `resources/licenses` → `licenses`, dan lisensi FFmpeg →
`licenses/FFmpeg-LICENSE.txt`. Ikon aplikasi dan installer diambil otomatis dari `build/icon.ico` (folder
`buildResources`). Kalau logo berubah, buat ulang `icon.ico` (16–256 px) dan `icon.png` (1024 px) dari logo yang baru.

Sebelum merilis installer yang menyertakan SFX bawaan, lengkapi sumber dan lisensinya di `resources/licenses/SFX-PROVENANCE-REQUIRED.txt`.

Installer hanya untuk Windows dan belum ditandatangani (*code signing*), jadi Windows SmartScreen menampilkan
peringatan saat pertama kali dijalankan. Installer macOS (`.dmg`) hanya bisa dibuat di Mac, dan butuh akun Apple
Developer supaya tidak diblokir Gatekeeper. Selain itu, Whisper versi macOS juga belum ada. Lihat
[masalah-diketahui.md](masalah-diketahui.md).

### Screenshot README

Gambar di `docs/images/` diambil dari aplikasi sungguhan dengan dev harness, memakai salinan data proyek:

1. Salin `studio.db` lewat backup SQLite (buka sumbernya read-only) ke folder uji, **kosongkan tabel `secrets`**,
   lalu salin folder `projects`.
2. Di rencana harness, isi kunci palsu (`{"main":"key","provider":"higgsfield","ok":true}`, juga untuk penyedia
   lain) supaya banner "atur kunci" tidak muncul. Set `STUDIO_HF_BASE=http://127.0.0.1:9` agar aplikasi tidak
   mengirim kunci palsu itu ke Higgsfield.
3. Ambil screenshot dengan `shot` (jendela bawaan 1440×900, isi halaman 1424×861).
4. Ubah ke WebP kualitas 90 dengan bingkai 1 px warna `line-2` (`#d4cbbb`), lalu hapus salinan data uji.

### Membagikan kode tanpa installer

Folder proyek bisa dibagikan tanpa `node_modules`, `out`, dan `dist`. Penerima cukup menjalankan `npm install`
lalu `npm run dev`. Salinan distribusi juga bisa diberi skrip `START - WIN.bat` (Windows) atau
`START - MAC.command` (macOS) yang memasang dependensi, mengunduh Electron, membuild kalau `out/` belum ada, lalu
membuka aplikasi.
