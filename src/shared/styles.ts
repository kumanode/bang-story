export type StyleCategory = '2d' | '3d' | 'realistis'

export interface VisualStyle {
  id: string
  name: string
  category: StyleCategory
  niche: string
  /** Tile colors used for the picker until a real sample image exists. */
  swatch: string
  ink: string
  /** Appended to every image prompt in the project. */
  prompt: string
  /** How characters should look on the character sheet. */
  characterHint: string
}

export const STYLE_CATEGORIES: { id: StyleCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: '2d', label: '2D' },
  { id: '3d', label: '3D' },
  { id: 'realistis', label: 'Realistis' }
]

const NO_TEXT = 'No text, no letters, no captions, no watermark, no logo.'

export const VISUAL_STYLES: VisualStyle[] = [
  {
    id: 'stickman',
    name: 'Stickman berwarna',
    category: '2d',
    niche: 'Sejarah, kisah nyata',
    swatch: '#F2B266',
    ink: '#1F1D1A',
    prompt:
      '2D flat vector illustration frame for a YouTube storytelling video. Colorful, detailed flat background (never plain white). ALL characters are simple STICKMAN figures: thin black line bodies, arms and legs, plain round white heads with minimal cartoon faces (dot eyes, small eyebrows, simple mouth), no realistic anatomy. Each stickman wears only small costume pieces that match their role (hat, crown, sash, headcloth, props) while the stick body stays visible. Clean bold outlines, flat colors with light soft shading, every character in the same consistent stickman style, cinematic composition with depth. ' +
      NO_TEXT,
    characterHint: 'a stickman figure with a round white head and thin black line limbs, wearing role-specific costume pieces'
  },
  {
    id: 'flat',
    name: 'Kartun flat',
    category: '2d',
    niche: 'Sains, fakta, edukasi',
    swatch: '#8CCBE3',
    ink: '#1F1D1A',
    prompt:
      'Flat vector explainer illustration, bold geometric shapes, a limited harmonious color palette, clean lines, friendly cartoon characters with simple features, soft subtle grain texture, clear readable composition. ' +
      NO_TEXT,
    characterHint: 'a friendly flat vector cartoon character with simple geometric features'
  },
  {
    id: 'whiteboard',
    name: 'Whiteboard doodle',
    category: '2d',
    niche: 'Tutorial, bisnis',
    swatch: '#FFFFFF',
    ink: '#1F1D1A',
    prompt:
      'Hand-drawn whiteboard doodle, black marker line art on a clean white board, one accent color used sparingly (red or blue), simple sketchy characters, arrows and small icons, like a whiteboard animation explainer. ' +
      NO_TEXT,
    characterHint: 'a simple hand-drawn marker doodle character'
  },
  {
    id: 'collage',
    name: 'Kolase kertas',
    category: '2d',
    niche: 'Dokumenter, jurnalisme',
    swatch: '#E9D8BA',
    ink: '#1F1D1A',
    prompt:
      'Paper cut-out collage, layered textured paper, vintage photo cutouts, halftone print textures, torn edges, soft shadows between paper layers, editorial documentary style. ' +
      NO_TEXT,
    characterHint: 'a paper cut-out collage figure with textured paper layers'
  },
  {
    id: 'watercolor',
    name: 'Buku cerita cat air',
    category: '2d',
    niche: 'Dongeng anak, religi',
    swatch: '#CFE3B5',
    ink: '#1F1D1A',
    prompt:
      "Children's storybook watercolor illustration, soft washes on textured paper, warm pastel palette, cute expressive characters, whimsical and cozy mood. " +
      NO_TEXT,
    characterHint: 'a cute storybook watercolor character'
  },
  {
    id: 'anime',
    name: 'Anime',
    category: '2d',
    niche: 'Drama, motivasi, fiksi',
    swatch: '#F5C3CD',
    ink: '#1F1D1A',
    prompt:
      'High-quality anime film still, clean cel shading, expressive characters, detailed painted background, cinematic lighting and color. ' +
      NO_TEXT,
    characterHint: 'an anime character with clean cel shading'
  },
  {
    id: 'noir',
    name: 'Komik noir',
    category: '2d',
    niche: 'Horor, true crime',
    swatch: '#2F3240',
    ink: '#FAF7F2',
    prompt:
      'Dark graphic-novel comic panel, heavy black ink shadows, high contrast, muted palette with a single accent color, dramatic angles, halftone texture, suspenseful mood. ' +
      NO_TEXT,
    characterHint: 'a graphic-novel character drawn with heavy ink shadows'
  },
  {
    id: 'pixel',
    name: 'Pixel art',
    category: '2d',
    niche: 'Gaming, nostalgia',
    swatch: '#8FD694',
    ink: '#1F1D1A',
    prompt: 'Detailed 16-bit pixel art scene, crisp pixels, limited retro palette, video game aesthetic, no blur. ' + NO_TEXT,
    characterHint: 'a 16-bit pixel art character sprite'
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk neon',
    category: '2d',
    niche: 'Sci-fi, masa depan, teknologi',
    swatch: '#1A102F',
    ink: '#00F0FF',
    prompt:
      'Cyberpunk anime illustration still, glowing magenta and cyan neon lights, futuristic cityscape backdrop with rain reflections, high-tech aesthetic, high contrast, stylized cel shading, cinematic composition. ' +
      NO_TEXT,
    characterHint: 'a cyberpunk character with futuristic streetwear and subtle glowing cyberware'
  },
  {
    id: 'retrocomic',
    name: 'Komik retro pop-art',
    category: '2d',
    niche: 'Super-hero, komedi, aksi',
    swatch: '#F4E04D',
    ink: '#1F1D1A',
    prompt:
      'Vintage 1980s retro comic book panel, bold graphic black ink linework, vibrant pop-art colors, visible Ben-Day halftone dots, dynamic composition, vintage newsprint paper texture. ' +
      NO_TEXT,
    characterHint: 'a retro comic book character with bold black ink outlines and halftone shading'
  },
  {
    id: 'ghibli',
    name: 'Ghibli anime hangat',
    category: '2d',
    niche: 'Cerita santai, dongeng, petualangan',
    swatch: '#A2D5C6',
    ink: '#1F1D1A',
    prompt:
      'Studio Ghibli inspired hand-painted anime film still, lush green landscapes, fluffy painterly cumulus clouds, warm nostalgic natural sunlight, charming expressive characters, gentle gouache watercolor textures, peaceful storybook atmosphere. ' +
      NO_TEXT,
    characterHint: 'a charming hand-painted Ghibli-inspired character with gentle expressive features'
  },
  {
    id: 'manhwa',
    name: 'Manhwa webtoon aksi',
    category: '2d',
    niche: 'Aksi, fantasi modern, reinkarnasi',
    swatch: '#2B1A4A',
    ink: '#C084FC',
    prompt:
      'High-end Korean manhwa webtoon digital art style, glowing vibrant energy aura, sharp dynamic digital ink outlines, dramatic high-contrast lighting, sleek character design, intense expressive eyes, cinematic webtoon panel composition. ' +
      NO_TEXT,
    characterHint: 'a sharp Korean webtoon hero character with subtle glowing aura and stylish hair'
  },
  {
    id: 'woodcut',
    name: 'Ukiran kayu klasik',
    category: '2d',
    niche: 'Filsafat, mitologi kuno, sejarah',
    swatch: '#D7C4A5',
    ink: '#2C1E14',
    prompt:
      'Detailed antique woodcut engraving print, fine cross-hatched black ink linework, vintage Renaissance etching, textured aged parchment paper background, dramatic chiaroscuro contrast, historical intellectual aesthetic. ' +
      NO_TEXT,
    characterHint: 'a classical figure rendered in vintage cross-hatched woodcut engraving style'
  },
  {
    id: 'animation3d',
    name: 'Animasi 3D',
    category: '3d',
    niche: 'Fabel, keluarga, anak',
    swatch: '#FFD66B',
    ink: '#1F1D1A',
    prompt:
      '3D animated feature film render, stylized characters with big expressive faces, soft global illumination, subsurface scattering, vibrant colors, cinematic depth of field. ' +
      NO_TEXT,
    characterHint: 'a stylized 3D animated film character with an expressive face'
  },
  {
    id: 'clay',
    name: 'Claymation',
    category: '3d',
    niche: 'Komedi, cerita anak',
    swatch: '#F4A988',
    ink: '#1F1D1A',
    prompt:
      'Claymation stop-motion scene, handcrafted plasticine characters and miniature sets, visible fingerprints and clay texture, soft studio lighting. ' +
      NO_TEXT,
    characterHint: 'a handcrafted plasticine clay character'
  },
  {
    id: 'lowpoly',
    name: 'Low-poly 3D',
    category: '3d',
    niche: 'Teknologi, sains',
    swatch: '#A7C7E7',
    ink: '#1F1D1A',
    prompt:
      'Low-poly 3D render, faceted geometric shapes, flat-shaded polygons, clean pastel colors, soft ambient lighting. ' + NO_TEXT,
    characterHint: 'a low-poly 3D character with faceted shapes'
  },
  {
    id: 'diorama',
    name: 'Diorama miniatur',
    category: '3d',
    niche: 'Sejarah, kota, perang',
    swatch: '#C9D9A6',
    ink: '#1F1D1A',
    prompt:
      'Tilt-shift miniature diorama, tiny detailed 3D figures and buildings, shallow depth of field, soft daylight, toy-like scale. ' +
      NO_TEXT,
    characterHint: 'a tiny detailed miniature figurine'
  },
  {
    id: 'isometric3d',
    name: 'Diorama isometrik 3D',
    category: '3d',
    niche: 'Simulasi, strategi, infografis',
    swatch: '#7BDCB5',
    ink: '#1F1D1A',
    prompt:
      'Clean isometric 3D render, miniature diorama block, smooth clay and stylized materials, soft warm ambient lighting, cute geometric props, orthographic angle, tilt-shift depth. ' +
      NO_TEXT,
    characterHint: 'a cute stylized 3D miniature character with rounded features'
  },
  {
    id: 'cinematic',
    name: 'Sinematik realistis',
    category: 'realistis',
    niche: 'Misteri, sejarah, drama',
    swatch: '#56607A',
    ink: '#FAF7F2',
    prompt:
      'Photorealistic cinematic film still, dramatic natural lighting, shallow depth of field, anamorphic lens look, rich color grading, subtle 35mm film grain. ' +
      NO_TEXT,
    characterHint: 'a photorealistic person, cinematic lighting'
  },
  {
    id: 'documentary',
    name: 'Foto dokumenter',
    category: 'realistis',
    niche: 'Fakta, berita, alam',
    swatch: '#8A9A7B',
    ink: '#FAF7F2',
    prompt:
      'Realistic documentary photograph, natural light, authentic details, candid composition, high detail, true-to-life colors. ' +
      NO_TEXT,
    characterHint: 'a realistic documentary portrait of a person'
  },
  {
    id: 'archival',
    name: 'Arsip sejarah',
    category: 'realistis',
    niche: 'Sejarah, perang, tokoh',
    swatch: '#B9A488',
    ink: '#1F1D1A',
    prompt:
      'Vintage archival photograph, faded sepia or black and white, film grain, light scratches and dust, historical documentary look. ' +
      NO_TEXT,
    characterHint: 'a person in a vintage archival sepia photograph'
  },
  {
    id: 'epic',
    name: 'Fantasi epik',
    category: 'realistis',
    niche: 'Mitologi, legenda',
    swatch: '#6C5B8E',
    ink: '#FAF7F2',
    prompt:
      'Epic realistic fantasy concept art, highly detailed, volumetric light, grand scale, painterly realism, cinematic composition. ' +
      NO_TEXT,
    characterHint: 'an epic realistic fantasy character, concept art'
  },
  {
    id: 'darkfantasy',
    name: 'Dark fantasy mistis',
    category: 'realistis',
    niche: 'Horor, mitologi, legenda gelap',
    swatch: '#242028',
    ink: '#E8D7B8',
    prompt:
      'Dark fantasy cinematic photograph, dramatic chiaroscuro lighting, deep atmospheric shadows, volumetric fog and mist, gothic folklore tone, weathered textures, rich cinematic mood. ' +
      NO_TEXT,
    characterHint: 'a dark fantasy figure with weathered clothing in moody dramatic lighting'
  },
  {
    id: 'analoghorror',
    name: 'Analog horror VHS',
    category: 'realistis',
    niche: 'Horor, misteri, konspirasi, SCP',
    swatch: '#1A1D1A',
    ink: '#4ADE80',
    prompt:
      'Authentic 1990s analog found-footage camcorder video still, CRT monitor scanlines, magnetic VHS tape noise and tracking distortion, eerie flashlight lighting, muted retro color grading, grainy low-light realism, uncanny suspenseful atmosphere. ' +
      NO_TEXT,
    characterHint: 'a person in an eerie found-footage VHS recording, harsh direct flashlight illumination'
  }
]

export function getStyle(id: string): VisualStyle {
  return VISUAL_STYLES.find((s) => s.id === id) ?? VISUAL_STYLES[0]
}
