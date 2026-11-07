import type { StoryFactMode, StoryFormat, StoryStyleId, StoryStyleProfile } from '@shared/types'

export interface StoryStyleRecipe {
  id: Exclude<StoryStyleId, 'custom-example'>
  opening: string
  perChapter: string
  closing: string
  address: string
  humor: string
  folklore: string
  voiceTags: string
  limits: { maxHedges: number; maxSentenceWords: number; maxRepeatedWord: number; addressViewer: boolean }
}

export const STORY_STYLE_RECIPES: StoryStyleRecipe[] = [
  {
    id: 'casual-education',
    opening: 'Ajak penonton membayangkan diri berada di situasi yang dekat dengan topik, lalu munculkan pertanyaan yang akan dijawab.',
    perChapter: 'Pakai perbandingan dengan kehidupan sekarang bila membantu. Ajukan pertanyaan beruntun sebelum jawaban yang mengejutkan. Berikan satu detail atau fakta menarik per bab.',
    closing: 'Kembali ke pertanyaan pembuka, rangkum jawaban dengan singkat, lalu tutup dengan satu kalimat pamungkas yang mudah diingat.',
    address: 'Sapa penonton dengan “kamu” secara wajar, bukan di setiap kalimat.',
    humor: 'Humor ringan boleh muncul sesekali jika tidak mengganggu fakta atau alur.',
    folklore: 'Jangan membingkai topik faktual sebagai cerita rakyat.',
    voiceTags: 'Gunakan tag suara hanya bila membantu penekanan; hindari tag teatrikal.',
    limits: { maxHedges: 2, maxSentenceWords: 28, maxRepeatedWord: 4, addressViewer: true }
  },
  {
    id: 'horror-folklore',
    opening: 'Buka dengan adegan yang menempatkan penonton di dalam suasana, menggunakan “kamu” dan detail inderawi yang spesifik.',
    perChapter: 'Bangun ketegangan melalui detail suara, cahaya, suhu, bau, atau sentuhan. Akhiri bab dengan pertanyaan atau ancaman yang membuat penonton ingin lanjut. Gunakan frasa “menurut cerita yang beredar” tepat sekali untuk menandai kisah sebagai cerita rakyat.',
    closing: 'Akhiri dengan gambaran atau kalimat pendek yang meninggalkan rasa merinding, tanpa menjelaskan ulang seluruh cerita.',
    address: 'Tempatkan “kamu” di dalam adegan pembuka dan gunakan sapaan langsung hanya jika terasa alami.',
    humor: 'Jangan gunakan humor.',
    folklore: 'Gambarkan kepercayaan sebagai cerita yang beredar; jangan menuduh suku, daerah, atau kelompok nyata dan jangan mengklaim cerita sebagai fakta.',
    voiceTags: 'Pakai <whispers> atau <long pause> hanya pada momen puncak yang memang membutuhkannya.',
    limits: { maxHedges: 1, maxSentenceWords: 24, maxRepeatedWord: 4, addressViewer: true }
  },
  {
    id: 'documentary',
    opening: 'Mulai dari momen, tempat, atau keputusan konkret yang menjadi pintu masuk ke peristiwa.',
    perChapter: 'Susun urutan sebab dan akibat dengan nama, tempat, dan detail yang jelas. Pisahkan fakta yang diketahui dari hal yang belum pasti.',
    closing: 'Tutup dengan akibat atau makna peristiwa yang bisa ditarik dari informasi yang sudah disampaikan.',
    address: 'Gunakan sapaan langsung secukupnya; utamakan narasi yang jelas dan dekat.',
    humor: 'Humor hanya jika sesuai konteks dan tidak meremehkan subjek.',
    folklore: 'Jangan menyamakan dugaan, legenda, dan catatan sejarah.',
    voiceTags: 'Gunakan tag jeda seperlunya untuk membantu rekaman.',
    limits: { maxHedges: 3, maxSentenceWords: 30, maxRepeatedWord: 5, addressViewer: false }
  },
  {
    id: 'fiction',
    opening: 'Mulai langsung dari kejadian yang mengganggu keadaan tokoh atau memunculkan tujuan cerita.',
    perChapter: 'Tunjukkan pilihan tokoh, akibatnya, dan perubahan yang mendorong bab berikutnya. Gunakan detail inderawi dan dialog tidak langsung yang ringkas.',
    closing: 'Berikan payoff emosional yang menjawab konflik utama, dengan satu gambaran akhir yang kuat.',
    address: 'Jangan menyapa penonton kecuali sudut pandang cerita memang membutuhkannya.',
    humor: 'Humor boleh sesuai karakter dan tidak merusak ketegangan.',
    folklore: 'Perlakukan dunia cerita sebagai fiksi dan hindari klaim bahwa kejadian rekaan adalah fakta.',
    voiceTags: 'Gunakan tag suara dengan hemat pada momen emosi yang jelas.',
    limits: { maxHedges: 1, maxSentenceWords: 26, maxRepeatedWord: 4, addressViewer: false }
  }
]

export function recipeFor(style: StoryStyleId | undefined): StoryStyleRecipe | null {
  if (style === 'custom-example') return null
  return STORY_STYLE_RECIPES.find((recipe) => recipe.id === style) ?? STORY_STYLE_RECIPES[0]
}

/** Plans saved before styles existed only carry a brief; pick the recipe that matches how that brief was written. */
export function styleFromBrief(factMode: StoryFactMode | undefined, format: StoryFormat | undefined): StoryStyleId {
  if (factMode === 'folklore') return 'horror-folklore'
  if (factMode === 'fiction') return 'fiction'
  if (format === 'documentary') return 'documentary'
  return 'casual-education'
}

export function styleGuidance(style: StoryStyleId | undefined, profiles: StoryStyleProfile[], profileId?: string): string {
  if (style === 'custom-example') {
    const profile = profiles.find((item) => item.id === profileId) ?? profiles[0]
    if (profile) return `Follow only these extracted style rules. Do not reproduce any source-example wording.\n${profile.guidance}`
  }
  // A deleted profile leaves the plan on custom-example; fall back to the default recipe rather than failing.
  const recipe = recipeFor(style) ?? STORY_STYLE_RECIPES[0]
  return [
    `Opening: ${recipe.opening}`,
    `Each chapter: ${recipe.perChapter}`,
    `Closing: ${recipe.closing}`,
    `Viewer address: ${recipe.address}`,
    `Humor: ${recipe.humor}`,
    `Folklore and sensitivity: ${recipe.folklore}`,
    `Voice tags: ${recipe.voiceTags}`,
    'Write one complete sentence per line. Keep sentences short and natural to say aloud. Do not read chapter titles.',
    'Limit hedge words such as “mungkin”; avoid repeating the same word or idea in a chapter.'
  ].join('\n')
}
