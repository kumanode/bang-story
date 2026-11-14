# Design Doc: Penambahan 3 Gaya Visual Stickman Baru

**Tanggal:** 2026-11-14  
**Status:** Menunggu Persetujuan  
**Penulis:** Antigravity  

---

## 1. Intent & The Why
Aplikasi Bang Story saat ini memiliki satu gaya `stickman` ("Stickman berwarna") yang menggunakan garis lidi tipis murni. Dalam produksi visual/video berbasis AI (Higgsfield), garis tipis murni terkadang mengalami distorsi anatomis (bocor ke anatomi manusia realistis saat mengenakan pakaian detail) atau garis berkedip (*flicker*) saat dianimasikan. 

Pengguna ingin memperkaya opsi visual dengan menambahkan 3 gaya stickman baru yang lebih stabil, ekspresif, dan relevan dengan tren storytelling YouTube modern, sambil **tetap mempertahankan** gaya stickman bawaan yang sudah ada agar proyek-proyek lama tidak terganggu.

---

## 2. Goals, Non-Goals, & Anti-Goals

### Goals
- Menambahkan 3 gaya visual stickman baru ke `VISUAL_STYLES` di `src/shared/styles.ts`:
  1. `oversimplified` (*Stickman kapsul / OverSimplified*) — Kepala bulat putih, badan kapsul tebal (*bean body*), *noodle limbs* tebal, kostum rapi, latar bertekstur.
  2. `stickman_comic` (*Stickman komedi ekspresif*) — Garis kontur tebal, *white sticker outline*, ekspresi wajah konyol/histeris yang dramatis (ala Dalang Pelo / Vernalta).
  3. `stickman_modern` (*Stickman modern explainer*) — Siluet geometris bersih, aksen garis berpendar/neon, latar bergradien sinematik (ala Kurzgesagt/modern explainer).
- Menyediakan thumbnail pratinjau `.webp` untuk masing-masing gaya baru di `src/renderer/src/assets/styles/` (atau *color swatch* fallback yang harmonis).
- Memastikan gaya `stickman` lama tetap ada tanpa perubahan ID maupun nilai bawaan database.

### Non-Goals
- Mengubah skema database SQLite (kolom `style_id` sudah bertipe `TEXT`, sehingga sepenuhnya kompatibel).
- Mengubah antarmuka pemilihan gaya (komponen `StyleMenu`, `StyleSwatch`, dan `IdeaStep` otomatis me-render semua item di `VISUAL_STYLES`).

### Anti-Goals
- Tidak merusak kompatibilitas proyek eksisting yang menggunakan `styleId: 'stickman'`.
- Tidak mengubah aturan `NO_TEXT` atau menghilangkan konsistensi framing naskah di `src/main/story.ts`.

---

## 3. Constraints
- Sesuai [AGENTS.md](file:///c:/Project/bang-story/AGENTS.md):
  - Teks antarmuka berbahasa Indonesia santai ("kamu"), nama kode dan komentar berbahasa Inggris.
  - Aturan prompt visual ditulis di `src/shared/styles.ts` agar dipakai bersama oleh main (generator) dan renderer (picker/preview).
  - TypeScript strict tanpa variabel atau impor yang tidak terpakai.

---

## 4. Approaches

### Pendekatan A: Mengganti prompt gaya `stickman` yang sudah ada
- Mengubah langsung definisi prompt pada ID `stickman`.
- *Trade-off:* Lebih ringkas tanpa menambah daftar gaya, tetapi berisiko mengubah estetika proyek pengguna yang sudah berjalan.

### Pendekatan B: Menambahkan 3 gaya baru & mempertahankan gaya lama *(Dipilih Pengguna)*
- Mempertahankan entri `stickman` lama.
- Menambahkan 3 entri baru: `oversimplified`, `stickman_comic`, dan `stickman_modern`.
- Menyiapkan thumbnail aset `.webp` persegi/16:9 yang mewakili masing-masing gaya di `src/renderer/src/assets/styles/`.
- *Trade-off:* Menambah 3 opsi di menu style picker, namun memberikan fleksibilitas total kepada pengguna untuk memilih karakter yang paling pas dengan tema ceritanya.

---

## 5. Detailed Design

### Definisi Style Baru di `src/shared/styles.ts`

```typescript
// 1. OverSimplified / Bold Noodle
{
  id: 'oversimplified',
  name: 'Stickman OverSimplified',
  category: '2d',
  niche: 'Sejarah, biografi, perang',
  swatch: '#EAB308',
  ink: '#1F1D1A',
  prompt:
    '2D flat vector storytelling illustration frame. Simple stylized stickman characters with round white heads, cute bean-shaped capsule bodies, and thick black noodle limbs. Minimalist cartoon faces with expressive dot eyes and small mouths. Characters wear neat miniature role-specific costume accessories (crowns, hats, uniforms, headcloths) over their capsule bodies. Clean bold outlines, flat colors with light soft shading, detailed historical vector background with depth, no realistic human anatomy. ' +
    NO_TEXT,
  characterHint: 'a stylized stickman with a round white head, a simple bean-shaped capsule body, thick noodle limbs, wearing role-specific miniature attire'
},

// 2. Komedi Ekspresif (Dalang Pelo / Vernalta Style)
{
  id: 'stickman_comic',
  name: 'Stickman komedi ekspresif',
  category: '2d',
  niche: 'Komedi, santai, cerita viral',
  swatch: '#EF4444',
  ink: '#FFFFFF',
  prompt:
    'Humorous 2D YouTube storytelling illustration. Stylized white stickman characters with thick bold black contour outlines and a clean white sticker halo border. Exaggerated hilarious facial expressions (wide comical cartoon eyes, open screaming or laughing mouths, dramatic eyebrows). Simple expressive stick limbs in dynamic poses. Vibrant colorful cartoon background with subtle comic action lines, bright energetic mood. ' +
    NO_TEXT,
  characterHint: 'an expressive white cartoon stickman with thick black outlines, a subtle white sticker halo, and an exaggerated funny facial expression'
},

// 3. Modern Explainer (Kurzgesagt Hybrid)
{
  id: 'stickman_modern',
  name: 'Stickman modern explainer',
  category: '2d',
  niche: 'Sains, teknologi, edukasi',
  swatch: '#6366F1',
  ink: '#FFFFFF',
  prompt:
    'Sleek modern 2D flat vector explainer frame. Elegant minimalist geometric stickman silhouette characters with clean proportions and glowing neon accent edge lighting. Harmonious deep color palette, volumetric ambient glow, cinematic atmospheric lighting, stylish vector infographic background with soft depth of field. ' +
    NO_TEXT,
  characterHint: 'a sleek minimalist geometric stickman silhouette with subtle glowing accent outlines'
}
```

### Penanganan Aset Thumbnail
- Memotong dan mengonversi 3 panel dari gambar pembanding yang sudah di-generate menjadi file `.webp`:
  - `src/renderer/src/assets/styles/oversimplified.webp`
  - `src/renderer/src/assets/styles/stickman_comic.webp`
  - `src/renderer/src/assets/styles/stickman_modern.webp`
- Dengan adanya file `.webp` ini, `styleThumb(id)` di `src/renderer/src/components/StyleArt.tsx` akan langsung mengenali dan menampilkan kartu gambar di pemilihan gaya secara otomatis tanpa perlu mengubah logika komponen.

---

## 6. Verifikasi & Pengujian
1. Jalankan `npm run typecheck` untuk memastikan tipe TypeScript valid dan tidak ada unused imports/vars.
2. Jalankan `npm run build` untuk memverifikasi bundle Vite renderer & main berhasil dikompilasi dengan aset `.webp` baru.
3. Buka halaman Project / Home untuk memastikan ketiga style baru muncul di menu dropdown/modal gaya dengan swatch/thumbnail yang rapi.
