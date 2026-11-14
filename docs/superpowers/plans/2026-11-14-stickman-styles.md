# Penambahan 3 Gaya Visual Stickman Baru Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan 3 gaya visual stickman baru (`oversimplified`, `stickman_comic`, `stickman_modern`) ke katalog `VISUAL_STYLES` di Bang Story beserta thumbnail pratinjau `.webp` dengan tetap mempertahankan gaya `stickman` lama.

**Architecture:** Mendefinisikan metadata gaya visual, deskripsi prompt, dan `characterHint` di `src/shared/styles.ts` agar dapat dikonsumsi bersama oleh proses generator cerita/gambar (main) dan antarmuka pemilih gaya (renderer). Menyiapkan aset thumbnail `.webp` di `src/renderer/src/assets/styles/` yang otomatis dimuat oleh `import.meta.glob` di `StyleArt.tsx`.

**Tech Stack:** TypeScript, React, Vite, Electron, Python (Pillow untuk slicing thumbnail `.webp`).

**Spec:** `docs/superpowers/specs/2026-11-14-stickman-styles-design.md`

## Global Constraints

- Teks antarmuka berbahasa Indonesia santai ("kamu"), nama kode dan komentar berbahasa Inggris.
- Jangan mengubah entri atau ID `stickman` lama agar kompatibilitas proyek eksisting terjaga.
- Seluruh gaya baru wajib menyertakan suffix `NO_TEXT` pada `prompt`.
- Seluruh gaya baru masuk ke kategori `'2d'` agar terfilter dengan benar di tab kategori.
- Bebas dari error lint/typecheck: TypeScript strict tanpa unused imports maupun unused variables.

## Review Focus

1. **Fallback style query**: Memanggil `getStyle('non_existent')` tetap mengembalikan style default pertama (`stickman`) tanpa crash.
2. **Ketersediaan Thumbnail**: Setiap ID gaya baru (`oversimplified`, `stickman_comic`, `stickman_modern`) memiliki file thumbnail `.webp` yang sesuai di `src/renderer/src/assets/styles/`.
3. **Integritas Prompt**: String prompt masing-masing gaya tidak memuat karakter newline tak terduga dan diakhiri `NO_TEXT`.
4. **Ukuran dan Aspek Thumbnail**: Thumbnail terpotong secara proporsional berfokus pada karakter sehingga terlihat jelas saat di-render dengan `object-cover`.
5. **Kompilasi Bundle**: Vite build sukses mem-bundle aset `.webp` baru ke folder `out/renderer`.

---

### Task 1: Generate dan Persiapkan Aset Thumbnail (.webp)

**Files:**
- Create: `src/renderer/src/assets/styles/oversimplified.webp`
- Create: `src/renderer/src/assets/styles/stickman_comic.webp`
- Create: `src/renderer/src/assets/styles/stickman_modern.webp`

**Interfaces:**
- Consumes: `C:\Users\PopGore\.gemini\antigravity\brain\c818c1d0-5fb1-453a-8a9b-63c500c038bd\stickman_storytelling_styles_comparison_1794642371955.jpg`
- Produces: File gambar WebP 640x360 untuk tiap panel gaya.

- [ ] **Step 1: Tulis skrip python sementara untuk memotong dan mengonversi 3 panel gambar**

Buat skrip `scripts/generate_style_thumbs.py`:
Potong panel kiri (0–458), tengah (459–917), dan kanan (918–1376), crop 16:9 berfokus pada karakter, resize ke 640x360, lalu simpan sebagai WebP berkualitas tinggi di `src/renderer/src/assets/styles/`.

- [ ] **Step 2: Jalankan skrip pemotong gambar**

Run: `python scripts/generate_style_thumbs.py`  
Expected: 3 file `.webp` terbentuk di `src/renderer/src/assets/styles/`.

- [ ] **Step 3: Verifikasi keberadaan dan ukuran file**

Run: `python -c "import os; from PIL import Image; [print(f, Image.open(f'src/renderer/src/assets/styles/{f}').size) for f in ['oversimplified.webp', 'stickman_comic.webp', 'stickman_modern.webp']]"`  
Expected: Tiap file ada dan berukuran (640, 360). Hapus skrip sementara `scripts/generate_style_thumbs.py`.

---

### Task 2: Tambahkan Definisi Gaya Baru ke `src/shared/styles.ts`

**Files:**
- Modify: `src/shared/styles.ts:39-40`

**Interfaces:**
- Consumes: Tipe `VisualStyle` dari `src/shared/styles.ts`.
- Produces: 3 item baru di array `VISUAL_STYLES` (`oversimplified`, `stickman_comic`, `stickman_modern`).

- [ ] **Step 1: Tambahkan 3 definisi gaya baru ke dalam `VISUAL_STYLES`**

Edit `src/shared/styles.ts` tepat setelah entri `stickman`:
1. `oversimplified`:
   - Name: `'Stickman OverSimplified'`
   - Category: `'2d'`
   - Niche: `'Sejarah, biografi, perang'`
   - Swatch: `'#EAB308'`, Ink: `'#1F1D1A'`
2. `stickman_comic`:
   - Name: `'Stickman komedi ekspresif'`
   - Category: `'2d'`
   - Niche: `'Komedi, santai, cerita viral'`
   - Swatch: `'#EF4444'`, Ink: `'#FFFFFF'`
3. `stickman_modern`:
   - Name: `'Stickman modern explainer'`
   - Category: `'2d'`
   - Niche: `'Sains, teknologi, edukasi'`
   - Swatch: `'#6366F1'`, Ink: `'#FFFFFF'`

- [ ] **Step 2: Jalankan skrip verifikasi fungsi `getStyle`**

Run: `node -e "const { VISUAL_STYLES, getStyle } = require('./out/shared/styles.js'); ..."` atau menggunakan `npx tsx -e "import { getStyle, VISUAL_STYLES } from './src/shared/styles'; console.log(getStyle('oversimplified').name); console.log(getStyle('stickman_comic').name); console.log(getStyle('stickman_modern').name);"`  
Expected: Menampilkan ketiga nama gaya baru dengan benar.

---

### Task 3: Verifikasi Typecheck dan Build Proyek

**Files:**
- Verify: `src/shared/styles.ts`
- Verify: `src/renderer/src/assets/styles/`

- [ ] **Step 1: Jalankan typecheck proyek**

Run: `npm run typecheck`  
Expected: Exit code 0 tanpa error TypeScript.

- [ ] **Step 2: Jalankan build aplikasi**

Run: `npm run build`  
Expected: Exit code 0, aset Vite dan Electron terkompilasi bersih ke folder `out/`.
