import { CAMERA_PRESETS, MOTION_STRENGTHS, TRANSITIONS } from '@shared/motion'
import { formatChapters } from '@shared/chapters'
import { LANGUAGES, clipCountFor } from '@shared/models'
import { estimateNarrationMs, needsVisual } from '@shared/script'
import { getStyle } from '@shared/styles'
import type { CameraPresetId, Clip, MotionStrength, MusicPrompt, ProjectBundle, StoryAct, StoryPlan, ThumbnailConcept, TransitionId, YoutubeMetadata } from '@shared/types'
import { applyVisuals, charactersOf, clipsOf, getBundle, getProject, replaceScript, type SceneVisual } from './repo'
import { generateJson } from './services/llm'
import { emit } from './events'

const CAMERA_IDS = CAMERA_PRESETS.map((c) => c.id)
const STRENGTH_IDS = MOTION_STRENGTHS.map((m) => m.id)
const TRANSITION_IDS = TRANSITIONS.map((t) => t.id)

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function languageOf(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.english ?? 'Indonesian'
}

// ---------- step 1 → 2: the script ----------

/** JSON Schema written to satisfy OpenAI strict mode (every property required, no extra keys) and Gemini. */
const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Short catchy video title in the target language, max 60 characters.' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Short scene title in the target language.' },
          story: {
            type: 'string',
            description: 'What happens in this scene, one or two sentences in the target language, so the writer can check the plot.'
          },
          narration: {
            type: 'string',
            description:
              'Natural voice-over for this scene in the target language, sized for its target duration. Keep the opening hook concise. May contain one or two English vocal tags in angle brackets.'
          }
        },
        required: ['title', 'story', 'narration']
      }
    }
  },
  required: ['title', 'scenes']
}

interface ScriptPlan {
  title?: string
  scenes?: { title?: string; story?: string; narration?: string }[]
}

interface ScriptOutline {
  title?: string
  acts?: { title?: string; summary?: string; scenes?: number }[]
}

const SCRIPT_OUTLINE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    acts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      title: { type: 'string' }, summary: { type: 'string' }, scenes: { type: 'integer' }
    }, required: ['title', 'summary', 'scenes'] } }
  }, required: ['title', 'acts']
}

const HOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { hooks: { type: 'array', items: { type: 'string' } } },
  required: ['hooks']
}

const REVISED_SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    story: { type: 'string', description: 'One or two sentences describing what happens in this scene.' },
    narration: { type: 'string', description: 'Natural voice-over in the target language, sized for this scene.' }
  },
  required: ['story', 'narration']
}

interface HookOptions { hooks?: string[] }

function balanceActs(source: ScriptOutline['acts'], count: number): StoryAct[] {
  const acts = (source ?? []).slice(0, count).map((a, i) => ({
    title: str(a.title) || `Babak ${i + 1}`,
    summary: str(a.summary),
    scenes: Math.max(1, Math.round(Number(a.scenes) || 1))
  }))
  if (!acts.length) throw new Error('AI belum menghasilkan kerangka cerita. Coba susun kerangka lagi.')
  let delta = count - acts.reduce((n, a) => n + a.scenes, 0)
  if (delta >= 0) acts[acts.length - 1].scenes += delta
  else {
    for (let i = acts.length - 1; i >= 0 && delta < 0; i--) {
      const reduce = Math.min(acts[i].scenes - 1, -delta)
      acts[i].scenes -= reduce
      delta += reduce
    }
    if (delta < 0) acts[acts.length - 1].scenes += delta
  }
  return acts
}

interface PendingLongScript {
  fingerprint: string
  title: string
  acts: { title: string; summary: string; scenes: number }[]
  groups: Map<number, { title?: string; story?: string; narration?: string }[]>
}

// If a model call fails, successful groups remain available for the user's next retry in this app session.
const pendingLongScripts = new Map<string, PendingLongScript>()

/** Offers several openings so the creator can choose the promise the story will fulfill. */
export async function generateHooks(projectId: string): Promise<string[]> {
  const project = getProject(projectId)
  if (!project.synopsis.trim()) throw new Error('Tulis ide cerita atau sinopsis dulu.')
  const lang = languageOf(project.language)
  const system = [
    'You write opening hooks for faceless YouTube stories and explainers.',
    'Create three distinct, truthful hooks in the target language: one vivid cold open, one curiosity question, and one surprising contradiction or consequence.',
    'Each hook is one short spoken line that can be shown as a concrete opening image.',
    'Do not invent factual claims for history or science topics. Do not use generic greetings or promise a twist the idea cannot deliver.',
    `Write in ${lang}.`
  ].join(' ')
  const result = await generateJson<HookOptions>({
    system,
    prompt: `Idea / synopsis:\n${project.synopsis}\n\nTarget video length: about ${project.durationSec} seconds. Return exactly three options.`,
    schema: HOOK_SCHEMA,
    name: 'story-hooks'
  })
  const hooks = (result.hooks ?? []).map(str).filter(Boolean).slice(0, 3)
  if (hooks.length < 3) throw new Error('AI belum menghasilkan tiga pilihan hook. Coba lagi.')
  return hooks
}

/** Builds the reviewable act outline around the hook the creator chose. */
export async function generateOutline(projectId: string, hook: string): Promise<StoryPlan> {
  const project = getProject(projectId)
  const chosenHook = str(hook)
  if (!project.synopsis.trim()) throw new Error('Tulis ide cerita atau sinopsis dulu.')
  if (!chosenHook) throw new Error('Pilih atau tulis hook dulu.')
  const lang = languageOf(project.language)
  const count = clipCountFor(project.durationSec)
  const previousPlan = project.storyPlan
  const system = [
    'You are a narrative architect for faceless YouTube stories and explainers.',
    'Make a coherent outline that starts by honoring the chosen hook, builds a clear cause-and-effect chain, escalates stakes or understanding, and resolves the hook promise.',
    'Use 3 to 6 acts, no more acts than scenes, with each act summary specific enough to draft scenes from.',
    'Keep history and science facts accurate; mark uncertainty in the summary rather than inventing evidence.',
    `Write the title and summaries in ${lang}.`
  ].join(' ')
  const outline = await generateJson<ScriptOutline>({
    system,
    prompt: `Idea / synopsis:\n${project.synopsis}\n\nChosen opening hook:\n${chosenHook}\n\nTarget video length: about ${project.durationSec} seconds.\nDistribute exactly ${count} scenes across the acts. The opening act must establish the hook and its central question; the final act must answer it. Return a short video title and the outline only.`,
    schema: SCRIPT_OUTLINE_SCHEMA,
    name: 'story-outline'
  })
  const plan: StoryPlan = {
    hookMode: previousPlan?.hookMode ?? 'manual',
    hookOptions: previousPlan?.hookOptions ?? [],
    hook: chosenHook,
    title: str(outline.title) || project.title,
    acts: balanceActs(outline.acts, count)
  }
  return plan
}

/** Writes scenes from the reviewed hook and outline. */
export async function generateScript(projectId: string): Promise<ProjectBundle> {
  const project = getProject(projectId)
  if (!project.synopsis.trim()) throw new Error('Tulis ide cerita atau sinopsis dulu.')
  const plan = project.storyPlan
  if (!plan?.hook.trim() || !plan.acts.length) throw new Error('Pilih hook dan susun kerangka cerita dulu.')
  const lang = languageOf(project.language)
  const count = clipCountFor(project.durationSec)
  const system = [
    'You are a scriptwriter for faceless YouTube storytelling and explainer videos.',
    'Turn the reviewed act outline into a sequence of short scenes. Each scene has a concrete story action and one natural voice-over passage.',
    'Scene 1 of the complete script must start with the exact chosen hook. Continue its question immediately and deliver its answer by the ending; never make a false promise.',
    'Every scene should add information, change a decision, increase stakes, or prepare a payoff. Avoid repeated exposition and generic transitions.',
    'Keep facts accurate for history and science topics, and always call each character by the same name.',
    'Where it helps delivery, add at most one English vocal tag in angle brackets, such as <short pause>, <long pause>, <chuckles>, <sigh>, <gasp> or <whispers>. Never add other markup.',
    `Write all story notes and narration in ${lang}, except vocal tags, which stay in English.`
  ].join(' ')
  const groups: { from: number; count: number; act: StoryAct }[] = []
  let offset = 0
  for (const act of plan.acts) {
    let left = act.scenes
    while (left > 0) {
      const take = Math.min(30, left)
      groups.push({ from: offset, count: take, act })
      offset += take
      left -= take
    }
  }
  const fingerprint = JSON.stringify([project.synopsis, project.durationSec, project.language, plan])
  let pending = count > 60 ? pendingLongScripts.get(projectId) : undefined
  if (!pending || pending.fingerprint !== fingerprint) {
    pending = { fingerprint, title: plan.title || project.title, acts: plan.acts, groups: new Map() }
    if (count > 60) pendingLongScripts.set(projectId, pending)
  }
  const wordsPerScene = Math.max(8, (project.durationSec / count - 0.6) * 2.6)
  const wordsLow = Math.round(wordsPerScene * 0.85)
  const wordsHigh = Math.round(wordsPerScene * 1.15)
  const built: { title?: string; story?: string; narration?: string }[] = []
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    let rows = pending.groups.get(i)
    if (!rows) {
      emit.storyProgress({ projectId, message: `Menulis adegan ${group.from + 1}–${group.from + group.count} dari ${count}` })
      const previous = [...pending.groups.values()].flat().slice(-2)
      const groupPrompt = [
        `Idea / synopsis:\n${project.synopsis}`,
        `Target video length: about ${project.durationSec} seconds. Write scenes ${group.from + 1} through ${group.from + group.count} (exactly ${group.count} scenes).`,
        `Video title: ${pending.title}`,
        group.from === 0
          ? `Chosen hook (use this exact wording at the start of scene 1 narration): ${plan.hook}`
          : `The opening hook has already been established: ${plan.hook}\nContinue its central question without repeating the hook, and reserve its answer for the ending.`,
        `Complete story outline:\n${plan.acts.map((a, n) => `${n + 1}. ${a.title} (${a.scenes} scenes): ${a.summary}`).join('\n')}`,
        `Current act: ${group.act.title}\nAct summary: ${group.act.summary}`,
        previous.length ? `Continue naturally from these last scenes:\n${previous.map((s) => `${s.title}: ${s.story} Narration: ${s.narration}`).join('\n')}` : 'This is the opening group. Begin with the chosen hook, then establish the situation and the question it raises.',
        `Write all scene titles, story notes and narration in ${lang}. Preserve character names and causal continuity. Narration should be ${wordsLow} to ${wordsHigh} spoken words per scene, except the opening hook may be shorter.`
      ].join('\n\n')
      const result = await generateJson<ScriptPlan>({ system, prompt: groupPrompt, schema: SCRIPT_SCHEMA, name: `script-part-${i + 1}` })
      rows = (result.scenes ?? []).filter((c) => str(c.narration) || str(c.story)).slice(0, group.count)
      if (rows.length < group.count) throw new Error(`Babak ${i + 1} menghasilkan ${rows.length} dari ${group.count} adegan. Coba lagi untuk melanjutkan.`)
      if (group.from === 0 && rows[0]) {
        const narration = str(rows[0].narration)
        if (!narration.toLocaleLowerCase().startsWith(plan.hook.toLocaleLowerCase())) rows[0].narration = `${plan.hook} ${narration}`.trim()
      }
      pending.groups.set(i, rows)
    }
    built.push(...rows)
    emit.storyProgress({ projectId, message: `Naskah ${Math.min(count, group.from + group.count)} dari ${count} adegan selesai` })
  }
  if (count > 60) pendingLongScripts.delete(projectId)
  const scenes = built.filter((c) => str(c.narration) || str(c.story))
  if (!scenes.length) throw new Error('Model tidak menghasilkan adegan. Coba lagi atau pilih model lain di Pengaturan.')

  replaceScript(
    projectId,
    plan.title || project.title,
    scenes.map((c, i) => ({
      title: str(c.title) || `Adegan ${i + 1}`,
      story: str(c.story),
      narration: str(c.narration),
      durationMs: estimateNarrationMs(str(c.narration))
    }))
  )
  return getBundle(projectId)
}

/** Rewrites one scene with nearby context so edits still fit the selected hook and act outline. */
export async function reviseScene(projectId: string, clipId: string, instruction: string): Promise<{ story: string; narration: string }> {
  const project = getProject(projectId)
  const clips = clipsOf(projectId)
  const index = clips.findIndex((c) => c.id === clipId)
  if (index < 0) throw new Error('Adegan yang dipilih tidak ditemukan.')
  const request = str(instruction)
  if (!request) throw new Error('Tulis perubahan yang kamu inginkan dulu.')
  const clip = clips[index]
  const lang = languageOf(project.language)
  const context = clips.slice(Math.max(0, index - 1), index + 2).map((c, i) =>
    `${Math.max(0, index - 1) + i + 1}. ${c.title}\nStory: ${c.story}\nNarration: ${c.narration}`
  ).join('\n\n')
  const result = await generateJson<{ story?: string; narration?: string }>({
    system: [
      'You are a script editor revising one scene in a faceless YouTube story or explainer.',
      'Follow the creator instruction while preserving established facts, character names, causal continuity, and the neighboring scenes.',
      'Keep the narration natural to speak and close to the original scene length. Do not alter the rest of the story.',
      `Write the replacement story note and narration in ${lang}.`
    ].join(' '),
    prompt: [
      `Idea / synopsis:\n${project.synopsis}`,
      project.storyPlan?.hook && `Opening hook: ${project.storyPlan.hook}`,
      project.storyPlan?.acts.length && `Reviewed outline:\n${project.storyPlan.acts.map((a) => `${a.title}: ${a.summary}`).join('\n')}`,
      `Context around the selected scene:\n${context}`,
      `Selected scene to revise:\n${index + 1}. ${clip.title}\nStory: ${clip.story}\nNarration: ${clip.narration}`,
      `Creator instruction: ${request}`
    ].filter(Boolean).join('\n\n'),
    schema: REVISED_SCENE_SCHEMA,
    name: 'revise-scene'
  })
  const story = str(result.story)
  const narration = str(result.narration)
  if (!story || !narration) throw new Error('AI belum menghasilkan revisi adegan yang lengkap. Coba lagi.')
  return { story, narration }
}

// ---------- step 2 → 3: visuals for the reviewed script ----------

const VISUAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    world: {
      type: 'string',
      description:
        'One English sentence that fixes the world of the whole video: the place (planet, country, city), the era or year, the technology level and who the people are (for example "humans living in a pressurized colony on Mars around 2150"). Every setting below must agree with it.'
    },
    characters: {
      type: 'array',
      description: 'Every recurring character in the requested scenes, including the existing ones unchanged. Empty if there are none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          identity: {
            type: 'string',
            description:
              'English, what the character is and looks like WITHOUT clothing: species (write "human" for people), gender, age, height and build, skin tone, face, hair, permanent body traits. No clothing, no art-style words.'
          },
          outfit: {
            type: 'string',
            description:
              'English, the default outfit the character wears in MOST of their scenes, with colors and one signature accessory. Choose what fits most scenes: everyday indoor clothes if most scenes are indoors, a spacesuit or armor only if most scenes need it.'
          }
        },
        required: ['name', 'identity', 'outfit']
      }
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scene: { type: 'integer', description: 'The scene number from the script.' },
          setting: {
            type: 'string',
            description:
              'English, self-contained: where and when, always naming the world explicitly (planet or country, era) even if the story makes it obvious, indoor or outdoor, 3 to 5 concrete props or architecture details that prove the world (for example a window showing the red Martian desert), lighting, time of day, color mood.'
          },
          action: {
            type: 'string',
            description:
              'English: the ONE moment shown. Every visible person with role, age, pose and expression, what they are doing, and the concrete visual evidence of what the narration says. Recurring characters by name plus a short role ("Leo, the colony doctor").'
          },
          wardrobe: {
            type: 'array',
            description: 'Clothing of every person visible in the image, including extras.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: 'Character name, or a short label for an extra ("the teenager").' },
                source: {
                  type: 'string',
                  enum: ['reference', 'custom'],
                  description:
                    'reference = the recurring character wears their default outfit as on the reference sheet; custom = a different outfit for this scene (always custom for extras).'
                },
                outfit: { type: 'string', description: 'English. For custom: the full outfit with colors. For reference: a few words naming it.' }
              },
              required: ['name', 'source', 'outfit']
            }
          },
          framing: { type: 'string', description: 'English: shot size, camera angle and composition, e.g. "medium full shot, eye level, the height chart fully visible".' },
          avoid: {
            type: 'string',
            description:
              'English, comma-separated: 3 to 6 things an image model is likely to get wrong for THIS scene, e.g. "Earth landscape, aliens, green skin, spacesuits indoors, helmets".'
          },
          characters: { type: 'array', items: { type: 'string' }, description: 'Names of recurring characters visible in the image.' },
          camera: { type: 'string', enum: CAMERA_IDS, description: 'Camera move over the still image that fits the scene mood.' },
          strength: {
            type: 'string',
            enum: STRENGTH_IDS,
            description: 'How strong the camera move is: halus (subtle, calm or emotional), sedang (medium), kuat (strong, action or big reveals).'
          },
          motion: {
            type: 'string',
            description:
              'English direction for animating this still image into a short AI video: what each character does (gesture, expression, small action), what moves in the environment (wind, fire, water, crowd, dust) and one simple camera move. One or two sentences, no dialogue, no on-screen text, never mention music or sound.'
          },
          transition: {
            type: 'string',
            enum: TRANSITION_IDS,
            description: 'Transition into the next scene: fade for calm or time passing, cut for fast action, slideleft for a change of place, zoomin for a dramatic reveal.'
          }
        },
        required: ['scene', 'setting', 'action', 'wardrobe', 'framing', 'avoid', 'characters', 'camera', 'strength', 'motion', 'transition']
      }
    }
  },
  required: ['world', 'characters', 'scenes']
}

type VisualScene = {
  scene?: number
  setting?: string
  action?: string
  wardrobe?: { name?: string; source?: string; outfit?: string }[]
  framing?: string
  avoid?: string
  characters?: string[]
  camera?: string
  strength?: string
  motion?: string
  transition?: string
}

interface VisualPlan {
  world?: string
  characters?: { name?: string; identity?: string; outfit?: string }[]
  scenes?: VisualScene[]
}

/** A character description for image prompts: body and face first, then the outfit shown on the reference sheet. */
function characterLook(c: { identity?: string; outfit?: string }): string {
  const who = str(c.identity).replace(/\.$/, '')
  const outfit = str(c.outfit).replace(/\.$/, '')
  return [who && `${who}.`, outfit && `Default outfit: ${outfit}.`].filter(Boolean).join(' ')
}

/**
 * The scene's image prompt as labelled lines the user can read and edit in the storyboard. The image
 * generator reads the Wardrobe and Avoid lines (see clipPrompt in generation.ts).
 */
function visualText(a: VisualScene): string {
  const wardrobe = (a.wardrobe ?? [])
    .filter((w) => str(w.name))
    .map((w) =>
      w.source === 'reference'
        ? `${str(w.name)} - default outfit as on the reference sheet${str(w.outfit) ? ` (${str(w.outfit)})` : ''}`
        : `${str(w.name)} - custom for this scene: ${str(w.outfit)}`
    )
  return [
    str(a.setting) && `Setting: ${str(a.setting)}`,
    str(a.action) && `Action: ${str(a.action)}`,
    wardrobe.length > 0 && `Wardrobe: ${wardrobe.join('; ')}`,
    str(a.framing) && `Framing: ${str(a.framing)}`,
    str(a.avoid) && `Avoid: ${str(a.avoid)}`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Designs one image per scene (plus camera move, transition and AI-video direction) from the reviewed
 * script. "missing" only covers scenes without a plan or whose story changed since; "all" redoes every scene.
 */
export async function generateVisuals(projectId: string, mode: 'missing' | 'all'): Promise<ProjectBundle> {
  const project = getProject(projectId)
  const clips = clipsOf(projectId)
  if (!clips.length) throw new Error('Naskah masih kosong. Tambahkan adegan dulu.')
  const empty = clips.findIndex((c) => !c.story.trim() && !c.narration.trim())
  if (empty >= 0) throw new Error(`Adegan ${empty + 1} masih kosong. Isi alur atau narasinya dulu.`)
  const targets = clips.map((c, i) => ({ clip: c, n: i + 1 })).filter((t) => mode === 'all' || needsVisual(t.clip))
  if (!targets.length) return getBundle(projectId)

  let known = charactersOf(projectId)
  const system = [
    'You are the storyboard artist for a faceless YouTube video. The script is final; you design the pictures.',
    'For each requested scene you describe ONE still image, choose the camera move and its strength over that image, the transition into the next scene, and write how the image would move if it is animated as an AI video.',
    'Rules for the image descriptions, which go to a text-to-image model that never sees the script:',
    '1. Every scene is self-contained. Always name the world (planet or country, era, technology) in the setting, even when the story makes it obvious, and add background details that prove it. Without this the model falls back to present-day Earth.',
    '2. Turn narration into a literal, showable moment. When the narration is a general statement ("after generations, children grow taller"), invent one concrete situation that shows it with visible evidence (a height chart, a comparison with an adult, an old photo), never a symbol or a vague mood.',
    '3. Describe people plainly as humans. Do not use words an image model may read literally or as fantasy, such as Martian, alien, native, creature, mutant, hybrid or "-born", unless they really are not human; describe the difference concretely instead ("a human teenager, about 2.1 m tall, very slender, long limbs, normal human face").',
    '4. Clothing must suit the place and action: no spacesuits or helmets inside a pressurized room, a spacesuit outside on an airless surface, period clothing for history. A recurring character keeps their default outfit (source "reference") unless the scene needs something else; then use "custom" and describe the new outfit in full. Describe the clothing of every extra too.',
    '5. Keep every recurring character visually consistent: reuse the existing characters exactly as given (same name, identity and outfit) and only add characters that are missing. Characters are only people who appear in several scenes; one-off people are extras described inside the scene.',
    '6. No readable text, signs, captions or labels in the image. Vary shot sizes, angles and camera moves across scenes so the video never feels repetitive.',
    'Write "world", "identity", "outfit", "setting", "action", "wardrobe", "framing", "avoid" and "motion" in English.'
  ].join('\n')
  const arc = clips.map((c, i) => `${i + 1}. ${c.title}: ${(c.story || c.narration).slice(0, 110)}`).join('\n')
  const groups: (typeof targets)[] = []
  for (let i = 0; i < targets.length; i += 20) groups.push(targets.slice(i, i + 20))
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    const wanted = new Set(group.map((t) => t.n))
    for (const t of group) {
      if (t.n > 1) wanted.add(t.n - 1)
      if (t.n < clips.length) wanted.add(t.n + 1)
    }
    const localScript = [...wanted].sort((a, b) => a - b).map((n) => {
      const c = clips[n - 1]
      return `Scene ${n}: ${c.title}\nStory: ${c.story || '(none)'}\nNarration (${languageOf(project.language)}): ${c.narration || '(none)'}`
    }).join('\n\n')
    const prompt = [
      `Visual style of the video (for framing only): ${getStyle(project.styleId).name}.`,
      `Frame format: ${project.aspectRatio === '9:16' ? 'vertical 9:16' : 'horizontal 16:9'}.`,
      `Idea: ${project.synopsis}`,
      `Story arc summary by scene:\n${arc}`,
      known.length ? `Recurring characters (preserve identity and outfit across all groups):\n${known.map((c) => `- ${c.name}: ${c.description}`).join('\n')}` : 'There are no known recurring characters yet.',
      `Full script for this group and its neighbors only:\n${localScript}`,
      `Write visual plans for scenes ${group.map((t) => t.n).join(', ')} only. Keep scene numbers unchanged.`,
      `Allowed camera values: ${CAMERA_IDS.join(', ')}. Allowed strength values: ${STRENGTH_IDS.join(', ')}. Allowed transition values: ${TRANSITION_IDS.join(', ')}.`
    ].join('\n\n')
    emit.storyProgress({ projectId, message: `Menyusun visual kelompok ${gi + 1} dari ${groups.length}` })
    const plan = await generateJson<VisualPlan>({ system, prompt, schema: VISUAL_SCHEMA, name: `visuals-part-${gi + 1}` })
    const answers = (plan.scenes ?? []).filter((s) => str(s.setting) || str(s.action))
    if (!answers.length) throw new Error(`Model tidak menghasilkan visual untuk kelompok ${gi + 1}. Coba lagi.`)
    const byNumber = new Map<number, (typeof answers)[number]>()
    const loose: typeof answers = []
    for (const a of answers) {
      const n = Number(a.scene)
      if (Number.isInteger(n) && group.some((t) => t.n === n) && !byNumber.has(n)) byNumber.set(n, a)
      else loose.push(a)
    }
    const updates: SceneVisual[] = []
    for (const t of group) {
      const a = byNumber.get(t.n) ?? loose.shift()
      if (a) updates.push(toSceneVisual(t.clip, a))
    }
    if (updates.length !== group.length) throw new Error(`Visual kelompok ${gi + 1} hanya mencakup ${updates.length} dari ${group.length} adegan. Coba lagi.`)
    applyVisuals(projectId, (plan.characters ?? []).filter((c) => str(c.name)).map((c) => ({ name: str(c.name), description: characterLook(c) })), updates)
    known = charactersOf(projectId)
    emit.storyProgress({ projectId, message: `Visual ${gi + 1} dari ${groups.length} kelompok selesai` })
  }
  return getBundle(projectId)
}

function toSceneVisual(clip: Clip, a: NonNullable<VisualPlan['scenes']>[number]): SceneVisual {
  const camera = str(a.camera) as CameraPresetId
  const strength = str(a.strength) as MotionStrength
  const transition = str(a.transition) as TransitionId
  return {
    clipId: clip.id,
    visualPrompt: visualText(a),
    characterNames: Array.isArray(a.characters) ? a.characters.filter((n): n is string => typeof n === 'string') : [],
    cameraPreset: CAMERA_IDS.includes(camera) ? camera : clip.cameraPreset,
    motionStrength: STRENGTH_IDS.includes(strength) ? strength : clip.motionStrength,
    videoPrompt: str(a.motion),
    transition: TRANSITION_IDS.includes(transition) ? transition : clip.transition
  }
}

// ---------- background music ----------

const MUSIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Short English track title, max 40 characters.' },
    style: {
      type: 'string',
      description:
        'Suno "Style of Music" field: 6 to 12 comma-separated English tags covering genre, mood, main instruments, tempo in BPM and "instrumental". Max 180 characters.'
    },
    exclude: { type: 'string', description: 'Suno "Exclude styles" field: comma-separated English tags to avoid, such as vocals or anything that would fight the voice-over. Max 80 characters.' },
    description: {
      type: 'string',
      description:
        'One English paragraph (50 to 90 words) for any text-to-music AI: genre, mood, instruments, tempo, how the energy moves from the opening to the ending, instrumental with no vocals, sits under a narrator, and the target length.'
    },
    reason: { type: 'string', description: 'One sentence in Indonesian telling the creator why this music suits the video.' }
  },
  required: ['title', 'style', 'exclude', 'description', 'reason']
}

/** A prompt for background music that suits the story, to paste into Suno or another music AI. */
export async function generateMusicPrompt(projectId: string): Promise<MusicPrompt> {
  const b = getBundle(projectId)
  const p = b.project
  const clips = b.clips
  if (!clips.some((c) => c.narration.trim() || c.story.trim()) && !p.synopsis.trim()) throw new Error('Naskah masih kosong.')
  const durationSec = Math.max(10, Math.round(clips.reduce((n, c) => n + c.durationMs, 0) / 1000) || p.durationSec)
  const style = getStyle(p.styleId)
  const system = [
    'You are a music supervisor for faceless YouTube storytelling videos.',
    'You pick background music that supports a voice-over without competing with it: instrumental, no vocals or choirs with words, clear space in the mid range where the voice sits.',
    'Match the setting and era of the story (for example gamelan or kendang colours for an old Javanese kingdom, orchestral for epic history, lo-fi for a calm explainer) and follow its emotional arc from the hook to the ending.',
    'Write the music fields in English, because music AIs understand English best. Never name real artists or copyrighted songs.'
  ].join(' ')
  const scenes = clips
    .map((c, i) => `${i + 1}. ${c.title}: ${c.story || c.narration}`.slice(0, 260))
    .join('\n')
  const prompt = [
    `Video title: ${p.title || '(untitled)'}`,
    `Idea: ${p.synopsis}`,
    `Visual style: ${style.name}.`,
    `Video length: about ${durationSec} seconds.`,
    `Scenes:\n${scenes}`
  ].join('\n\n')
  const r = await generateJson<Partial<MusicPrompt>>({ system, prompt, schema: MUSIC_SCHEMA, name: 'music' })
  const out: MusicPrompt = {
    title: str(r.title),
    style: str(r.style),
    exclude: str(r.exclude),
    description: str(r.description),
    reason: str(r.reason),
    durationSec
  }
  if (!out.style && !out.description) throw new Error('Model tidak menghasilkan prompt musik. Coba lagi.')
  return out
}

const YOUTUBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titles: {
      type: 'array',
      items: { type: 'string' },
      description: '3 catchy, high-CTR YouTube titles in the video language.'
    },
    description: {
      type: 'string',
      description: 'SEO-optimized YouTube video description with a strong hook, summary of the story, and call to action.'
    },
    hashtags: {
      type: 'array',
      items: { type: 'string' },
      description: '5 to 8 relevant trending hashtags including the core topic.'
    }
  },
  required: ['titles', 'description', 'hashtags']
}

export async function generateYoutubeMetadata(projectId: string): Promise<YoutubeMetadata> {
  const b = getBundle(projectId)
  const p = b.project
  const clips = b.clips
  if (!clips.length) throw new Error('Naskah masih kosong.')
  const lang = languageOf(p.language)
  const chapters = formatChapters(clips)
  const durationSec = Math.max(10, Math.round(clips.reduce((n, c) => n + c.durationMs, 0) / 1000) || p.durationSec)
  const scenes = clips.slice(0, 40).map((c, i) => `${i + 1}. ${c.title}: ${(c.story || c.narration).slice(0, 120)}`).join('\n')
  const system = [
    'You are a YouTube packaging and SEO expert for high-engagement storytelling channels.',
    `The video language is ${lang}. Write titles and description in ${lang}.`,
    'Focus on emotional hooks, high CTR, and viewer retention.'
  ].join(' ')
  const prompt = [
    `Video Title: ${p.title || '(untitled)'}`,
    `Synopsis / Concept: ${p.synopsis}`,
    `Duration: ${durationSec}s`,
    `Scenes:\n${scenes}`,
    `Timeline Chapters:\n${chapters}`
  ].join('\n\n')

  const r = await generateJson<Partial<YoutubeMetadata>>({ system, prompt, schema: YOUTUBE_SCHEMA, name: 'youtube_meta' })
  const titles = Array.isArray(r.titles) ? r.titles.map(str).filter(Boolean) : [p.title]
  const description = str(r.description)
  const hashtags = Array.isArray(r.hashtags) ? r.hashtags.map(str).filter(Boolean) : ['#Storytelling', '#BangStory']

  return {
    titles: titles.length ? titles : [p.title],
    description: description ? `${description}\n\n⏱️ DAFTAR BAB:\n${chapters}\n\n${hashtags.join(' ')}` : `${p.synopsis}\n\n⏱️ DAFTAR BAB:\n${chapters}\n\n${hashtags.join(' ')}`,
    chapters,
    hashtags
  }
}

const THUMBNAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'string',
      description:
        'English image prompt for the thumbnail scene: one focal subject, emotion, setting, lighting, camera distance. No instructions about text.'
    },
    composition: { type: 'string', description: 'Short explanation of layout, lighting and emotion, in the video language.' },
    textHook: { type: 'string', description: '2-4 word uppercase thumbnail text in the video language that complements the title.' }
  },
  required: ['prompt', 'composition', 'textHook']
}

/**
 * A thumbnail concept for the title the user picked. Written after the title on purpose: a thumbnail that
 * shows the same promise as the title converts better than one planned in isolation.
 */
export async function generateThumbnailConcept(projectId: string, title: string): Promise<ThumbnailConcept> {
  const b = getBundle(projectId)
  const p = b.project
  const clean = title.trim()
  if (!clean) throw new Error('Pilih atau tulis judul dulu.')
  if (!b.clips.length) throw new Error('Naskah masih kosong.')
  const lang = languageOf(p.language)
  const scenes = b.clips.slice(0, 40).map((c, i) => `${i + 1}. ${c.title}: ${(c.story || c.narration).slice(0, 120)}`).join('\n')
  const cast = b.characters.map((c) => `- ${c.name}: ${c.description}`).join('\n')
  const system = [
    'You design YouTube thumbnails for storytelling channels that get high click-through rates.',
    'The thumbnail and the title must work as a pair: the picture shows the emotional moment the title promises,',
    'raises a question, and does not spoil the ending.',
    'Keep it simple enough to read at phone size: one focal subject (usually the main character, face large and',
    'expressive), one strong prop or setting cue, high contrast, and empty space on one side for big text.',
    `Write prompt in English. Write composition and textHook in ${lang}.`,
    'textHook adds tension the title does not already say (never repeat the title word for word).'
  ].join(' ')
  const prompt = [
    `Chosen title: ${clean}`,
    `Synopsis: ${p.synopsis}`,
    `Visual style: ${getStyle(p.styleId).name}`,
    cast && `Characters:\n${cast}`,
    `Scenes:\n${scenes}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const r = await generateJson<Partial<ThumbnailConcept>>({ system, prompt, schema: THUMBNAIL_SCHEMA, name: 'thumbnail_concept' })
  return {
    title: clean,
    prompt: str(r.prompt) || `Dramatic close-up of the main character reacting to the moment described by the title "${clean}", high contrast, atmospheric lighting`,
    composition: str(r.composition),
    textHook: str(r.textHook).toUpperCase() || clean.split(/\s+/).slice(0, 3).join(' ').toUpperCase()
  }
}
