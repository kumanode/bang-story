import { CAMERA_PRESETS, MOTION_STRENGTHS, TRANSITIONS } from '@shared/motion'
import { formatChapters } from '@shared/chapters'
import { LANGUAGES, clipCountFor } from '@shared/models'
import { estimateNarrationMs, needsVisual, wordCount } from '@shared/script'
import { getStyle } from '@shared/styles'
import type {
  CameraPresetId,
  Clip,
  MotionStrength,
  MusicPrompt,
  Project,
  ProjectBundle,
  StoryAct,
  StoryBrief,
  StoryFactMode,
  StoryFormat,
  StoryPlan,
  ThumbnailConcept,
  TransitionId,
  YoutubeMetadata
} from '@shared/types'
import { applyVisuals, charactersOf, clipsOf, getBundle, getProject, replaceScript, setStoryPlan, type SceneVisual } from './repo'
import { splitNarration } from './narrationSplit'
import { generateJson } from './services/llm'
import { emit } from './events'

const CAMERA_IDS = CAMERA_PRESETS.map((c) => c.id)
const STRENGTH_IDS = MOTION_STRENGTHS.map((m) => m.id)
const TRANSITION_IDS = TRANSITIONS.map((t) => t.id)

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strList = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : [])

function languageOf(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.english ?? 'Indonesian'
}

// ---------- step 1: brief, hook and outline ----------

const FORMATS: StoryFormat[] = ['story', 'list', 'explainer', 'documentary', 'factcheck']
const FACT_MODES: StoryFactMode[] = ['factual', 'folklore', 'fiction']

const FORMAT_GUIDE: Record<StoryFormat, string> = {
  story: 'A narrative: characters with a goal, rising tension, and a payoff. Show events as they happen instead of summarizing them from outside.',
  list: 'A catalogue of items. Each item gets its own stretch: name it clearly, give its distinguishing traits, the story or origin told about it, and one memorable detail. Keep the intro and outro short.',
  explainer: 'Pose the question, explain the mechanism step by step with concrete examples, and end with a clear takeaway.',
  documentary: 'Real events in order: people, places, decisions, and their consequences.',
  factcheck: 'Present the claim fairly, weigh the evidence for and against it, and deliver a clear verdict.'
}

const FACT_RULE: Record<StoryFactMode, string> = {
  factual: 'This topic is real-world fact. Keep facts accurate and do not invent dates, numbers, names, or quotes. If something is uncertain, say so once, briefly, and move on.',
  folklore:
    'This topic is folklore, legend, myth, or horror lore. Frame it once, near the start, as what people tell or believe. After that, tell each version vividly and with conviction, the way a storyteller would. Do not debunk it, do not keep repeating that it is unproven, and do not turn it into a debate about whether it is real.',
  fiction: 'This is fiction. Commit fully to the story world, with no disclaimers.'
}

// A fact-check is the one format where weighing truth is the point, whatever the topic.
const factRule = (brief: StoryBrief): string => FACT_RULE[brief.format === 'factcheck' ? 'factual' : brief.factMode]

function briefText(brief: StoryBrief): string {
  return [
    `Format: ${brief.format}. ${FORMAT_GUIDE[brief.format]}`,
    `Truth mode: ${factRule(brief)}`,
    brief.tone && `Tone: ${brief.tone}`,
    brief.angle && `Angle: ${brief.angle}`,
    brief.mustCover.length && `Must cover (the viewer expects all of these):\n${brief.mustCover.map((p) => `- ${p}`).join('\n')}`,
    brief.avoid.length && `Avoid (off-topic for the creator):\n${brief.avoid.map((p) => `- ${p}`).join('\n')}`
  ].filter(Boolean).join('\n')
}

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    format: { type: 'string', enum: FORMATS },
    factMode: { type: 'string', enum: FACT_MODES },
    tone: { type: 'string', description: 'Mood and voice of the narration, a few words.' },
    angle: { type: 'string', description: 'Point of view the narrator takes, one sentence.' },
    mustCover: { type: 'array', items: { type: 'string' }, description: 'Concrete items the viewer must get: names, types, events, or steps.' },
    avoid: { type: 'array', items: { type: 'string' }, description: 'Directions the creator would consider off-topic.' }
  },
  required: ['format', 'factMode', 'tone', 'angle', 'mustCover', 'avoid']
}

function normalizeBrief(raw: Partial<StoryBrief> | undefined): StoryBrief {
  const format = FORMATS.includes(raw?.format as StoryFormat) ? (raw?.format as StoryFormat) : 'story'
  const factMode = FACT_MODES.includes(raw?.factMode as StoryFactMode) ? (raw?.factMode as StoryFactMode) : 'factual'
  return { format, factMode, tone: str(raw?.tone), angle: str(raw?.angle), mustCover: strList(raw?.mustCover, 12), avoid: strList(raw?.avoid, 6) }
}

/** Reads what the creator wants delivered, so later steps cannot drift into a different video. */
export async function generateBrief(projectId: string): Promise<StoryBrief> {
  const project = getProject(projectId)
  if (!project.synopsis.trim()) throw new Error('Tulis ide cerita atau sinopsis dulu.')
  const lang = languageOf(project.language)
  const count = clipCountFor(project.durationSec)
  const system = [
    'You are a development editor for faceless YouTube videos. Read the creator idea literally and work out the video they expect to watch.',
    'Keep the premise exactly as given: if the idea asks for types, the video presents those types; if it tells a story, the video tells it.',
    'Never reframe the idea into a fact-check or a debate unless the creator explicitly asks whether something is true.',
    'Choose the format and truth mode that fit. Ghosts, urban legends, myths, and horror lore use the folklore truth mode.',
    'mustCover lists concrete things the viewer must get, such as names, types, events, or steps. Never list meta topics such as "why versions differ" unless the idea asks for them.',
    'For a list, include each item the idea implies, using the versions most commonly told.',
    `Write tone, angle, mustCover, and avoid in ${lang}.`
  ].join(' ')
  const raw = await generateJson<Partial<StoryBrief>>({
    system,
    prompt: `Creator idea:\n${project.synopsis}\n\nTarget video length: about ${project.durationSec} seconds (${count} short scenes). List at most one must-cover point per three scenes.`,
    schema: BRIEF_SCHEMA,
    name: 'story-brief'
  })
  const brief = normalizeBrief(raw)
  if (!brief.mustCover.length) throw new Error('AI belum bisa merumuskan arah cerita. Coba lagi atau perjelas idenya.')
  return brief
}

/** Old plans have no brief; the script step creates one so every project is written the same way. */
async function briefFor(project: Project): Promise<StoryBrief> {
  const saved = project.storyPlan?.brief
  if (saved) return normalizeBrief(saved)
  const brief = await generateBrief(project.id)
  if (project.storyPlan) setStoryPlan(project.id, { ...project.storyPlan, brief })
  return brief
}

const HOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { hooks: { type: 'array', items: { type: 'string' } } },
  required: ['hooks']
}

interface HookOptions { hooks?: string[] }

/** Offers several openings that all promise the video the brief describes. */
export async function generateHooks(projectId: string, rawBrief?: StoryBrief): Promise<string[]> {
  const project = getProject(projectId)
  if (!project.synopsis.trim()) throw new Error('Tulis ide cerita atau sinopsis dulu.')
  const brief = rawBrief ? normalizeBrief(rawBrief) : await briefFor(project)
  const lang = languageOf(project.language)
  const system = [
    'You write opening hooks for faceless YouTube videos.',
    'Write three distinct hooks, each one short spoken line that can be shown as a concrete opening image.',
    brief.format === 'factcheck'
      ? 'Each hook states the claim being checked and makes the viewer want the verdict.'
      : 'Each hook promises exactly what the brief delivers and keeps the premise intact. Never question, doubt, or undermine the premise, and never ask whether it is true.',
    'Use three techniques: a vivid cold open, a teaser of the most striking thing the video will show, and a direct line to the viewer.',
    factRule(brief),
    'No generic greetings, and no twist the brief cannot deliver.',
    `Write in ${lang}.`
  ].join(' ')
  const result = await generateJson<HookOptions>({
    system,
    prompt: `Creator idea:\n${project.synopsis}\n\nBrief:\n${briefText(brief)}\n\nTarget video length: about ${project.durationSec} seconds. Return exactly three options.`,
    schema: HOOK_SCHEMA,
    name: 'story-hooks'
  })
  const hooks = (result.hooks ?? []).map(str).filter(Boolean).slice(0, 3)
  if (hooks.length < 3) throw new Error('AI belum menghasilkan tiga pilihan hook. Coba lagi.')
  return hooks
}

interface ScriptOutline {
  title?: string
  acts?: { title?: string; summary?: string; scenes?: number; beats?: string[] }[]
}

const SCRIPT_OUTLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    acts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          scenes: { type: 'integer' },
          beats: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'summary', 'scenes', 'beats']
      }
    }
  },
  required: ['title', 'acts']
}

function balanceActs(source: ScriptOutline['acts'], count: number): StoryAct[] {
  const acts = (source ?? []).slice(0, count).map((a, i) => ({
    title: str(a.title) || `Babak ${i + 1}`,
    summary: str(a.summary),
    scenes: Math.max(1, Math.round(Number(a.scenes) || 1)),
    beats: strList(a.beats, 8)
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

const outlineText = (acts: StoryAct[]): string =>
  acts.map((a, n) => `${n + 1}. ${a.title} (${a.scenes} scenes): ${a.summary}${a.beats?.length ? `\n   Beats: ${a.beats.join('; ')}` : ''}`).join('\n')

/** Builds the reviewable act outline so every brief point lands in exactly one act. */
export async function generateOutline(projectId: string, hook: string, rawBrief?: StoryBrief): Promise<StoryPlan> {
  const project = getProject(projectId)
  const chosenHook = str(hook)
  if (!project.synopsis.trim()) throw new Error('Tulis ide cerita atau sinopsis dulu.')
  if (!chosenHook) throw new Error('Pilih atau tulis hook dulu.')
  const brief = rawBrief ? normalizeBrief(rawBrief) : await briefFor(project)
  const lang = languageOf(project.language)
  const count = clipCountFor(project.durationSec)
  const previousPlan = project.storyPlan
  const system = [
    'You are a narrative architect for faceless YouTube videos.',
    FORMAT_GUIDE[brief.format],
    factRule(brief),
    'The opening act honors the chosen hook; the final act fulfils its promise.',
    'Assign every must-cover point to exactly one act as its beats. No two acts cover the same ground, and no act repeats an earlier one.',
    'Use 3 to 8 acts, never more acts than scenes. For a list, use about one act per item and group items only when there are more than 8.',
    'Summaries say concretely what the viewer sees or learns. Never describe the video from outside, as in "the video explains" or "the narration stresses".',
    `Write the title, summaries, and beats in ${lang}.`
  ].join(' ')
  const outline = await generateJson<ScriptOutline>({
    system,
    prompt: [
      `Creator idea:\n${project.synopsis}`,
      `Brief:\n${briefText(brief)}`,
      `Chosen opening hook:\n${chosenHook}`,
      `Target video length: about ${project.durationSec} seconds. Distribute exactly ${count} scenes across the acts, giving more scenes to acts with more to show. Return a short video title and the outline only.`
    ].join('\n\n'),
    schema: SCRIPT_OUTLINE_SCHEMA,
    name: 'story-outline'
  })
  return {
    hookMode: previousPlan?.hookMode ?? 'manual',
    hookOptions: previousPlan?.hookOptions ?? [],
    hook: chosenHook,
    title: str(outline.title) || project.title,
    acts: balanceActs(outline.acts, count),
    brief
  }
}

// ---------- step 1 → 2: the script ----------

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    acts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { narration: { type: 'string', description: 'The full voice-over of this act as continuous spoken prose.' } },
        required: ['narration']
      }
    }
  },
  required: ['acts']
}

const ACT_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { narration: { type: 'string', description: 'The full voice-over of this act as continuous spoken prose.' } },
  required: ['narration']
}

/** OpenAI strict mode needs every property required and no extra keys; Gemini accepts the same shape. */
const SCENE_NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Short scene title in the target language.' },
          story: { type: 'string', description: 'One concrete sentence of what is on screen: who or what, where, doing what.' }
        },
        required: ['title', 'story']
      }
    }
  },
  required: ['scenes']
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scene: { type: 'integer', description: 'Scene number as listed.' },
          problem: { type: 'string' },
          instruction: { type: 'string', description: 'What the rewrite of this scene must do.' }
        },
        required: ['scene', 'problem', 'instruction']
      }
    }
  },
  required: ['issues']
}

const REVISED_SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    story: { type: 'string', description: 'One concrete sentence of what is on screen in this scene.' },
    narration: { type: 'string', description: 'Natural voice-over in the target language, sized for this scene.' }
  },
  required: ['story', 'narration']
}

interface DraftScene { title: string; story: string; narration: string }

interface PendingScript {
  fingerprint: string
  drafts: Map<number, string>
  notes: Map<number, { title?: string; story?: string }[]>
}

// If a model call fails, finished stages stay available for the user's next retry in this app session.
const pendingScripts = new Map<string, PendingScript>()

const VOICE_TAG_RULE =
  'Where it helps delivery, add an English vocal tag in angle brackets, such as <short pause>, <long pause>, <chuckles>, <sigh>, <gasp>, or <whispers>, at most one per 40 words. Never add other markup.'
const MAX_REVIEW_FIXES = 8
const NOTES_GROUP = 40

function draftSystem(brief: StoryBrief, lang: string): string {
  return [
    'You are a scriptwriter for faceless YouTube videos. Write the voice-over as continuous spoken prose, the way a skilled narrator talks: connected sentences, concrete details, no headings, no lists, no stage directions.',
    FORMAT_GUIDE[brief.format],
    factRule(brief),
    'Deliver every beat with specific content such as names, traits, events, and sensory detail instead of talking about the topic from outside.',
    'Never repeat a point that was already made, and skip filler transitions such as "let us continue".',
    'Shape narration around the listed beats in order. Give each sentence one clear story moment that could be illustrated; keep complete sentences intact because scenes are grouped at sentence boundaries.',
    VOICE_TAG_RULE,
    `Write in ${lang}, except vocal tags, which stay in English.`
  ].join(' ')
}

function planContext(project: Project, plan: StoryPlan, brief: StoryBrief): string {
  return [
    `Creator idea:\n${project.synopsis}`,
    `Brief:\n${briefText(brief)}`,
    `Video title: ${plan.title || project.title}`,
    `Chosen opening hook: ${plan.hook}`,
    `Complete outline:\n${outlineText(plan.acts)}`
  ].join('\n\n')
}

const actTarget = (act: StoryAct, wordsPerScene: number): number => Math.round(act.scenes * wordsPerScene)

/** Writes each act as one flowing narration; short scripts in one call so the whole arc is planned together. */
async function draftActs(project: Project, plan: StoryPlan, brief: StoryBrief, pending: PendingScript, wordsPerScene: number): Promise<string[]> {
  const lang = languageOf(project.language)
  const system = draftSystem(brief, lang)
  const context = planContext(project, plan, brief)
  const count = plan.acts.reduce((n, a) => n + a.scenes, 0)
  const hookRule = 'Begin act 1 with the exact chosen hook as its opening sentence. Continue with the concrete consequence that makes the viewer want the answer; do not restate the hook or its idea.'
  if (count <= 60 && pending.drafts.size < plan.acts.length) {
    emit.storyProgress({ projectId: project.id, message: 'Menulis narasi utuh…' })
    const lengths = plan.acts.map((a, i) => `Act ${i + 1}: about ${actTarget(a, wordsPerScene)} spoken words`).join('\n')
    const result = await generateJson<{ acts?: { narration?: string }[] }>({
      system,
      prompt: `${context}\n\n${hookRule} Write the narration for all ${plan.acts.length} acts, in order, one entry per act. Each act delivers its beats and flows into the next.\n${lengths}`,
      schema: DRAFT_SCHEMA,
      name: 'script-draft'
    })
    const acts = (result.acts ?? []).map((a) => str(a.narration))
    if (acts.length < plan.acts.length || acts.some((a) => !a)) throw new Error('AI belum menulis narasi untuk semua babak. Coba lagi.')
    acts.slice(0, plan.acts.length).forEach((a, i) => pending.drafts.set(i, a))
  }
  for (let i = 0; i < plan.acts.length; i++) {
    if (pending.drafts.has(i)) continue
    const act = plan.acts[i]
    emit.storyProgress({ projectId: project.id, message: `Menulis narasi babak ${i + 1} dari ${plan.acts.length}` })
    const before = [...pending.drafts.entries()].sort((a, b) => a[0] - b[0])
    const covered = plan.acts.slice(0, i).map((a, n) => `${n + 1}. ${a.title}: ${(a.beats ?? []).join('; ') || a.summary}`).join('\n')
    const tail = before.length ? before[before.length - 1][1].split(/\s+/).slice(-120).join(' ') : ''
    const result = await generateJson<{ narration?: string }>({
      system,
      prompt: [
        context,
        i === 0 ? hookRule : `Already covered in earlier acts, do not repeat:\n${covered}`,
        tail && `The narration so far ends with:\n…${tail}\nContinue seamlessly from there.`,
        `Write act ${i + 1}: ${act.title}. ${act.summary}${act.beats?.length ? `\nBeats to deliver: ${act.beats.join('; ')}` : ''}\nAbout ${actTarget(act, wordsPerScene)} spoken words.`
      ].filter(Boolean).join('\n\n'),
      schema: ACT_DRAFT_SCHEMA,
      name: `script-draft-${i + 1}`
    })
    const narration = str(result.narration)
    if (!narration) throw new Error(`Narasi babak ${i + 1} masih kosong. Coba lagi untuk melanjutkan.`)
    pending.drafts.set(i, narration)
  }
  const drafts = plan.acts.map((_, i) => pending.drafts.get(i) ?? '')
  if (!drafts[0].trimStart().toLocaleLowerCase().startsWith(plan.hook.trim().toLocaleLowerCase())) {
    throw new Error('Pembuka belum memakai hook terpilih secara utuh. Coba buat naskah lagi agar hook menyatu dengan cerita.')
  }
  return drafts
}

/** Adds titles and on-screen descriptions to the cut narration; the visual step plans images from these. */
async function writeSceneNotes(project: Project, plan: StoryPlan, brief: StoryBrief, pending: PendingScript, scenes: { act: number; narration: string }[]): Promise<DraftScene[]> {
  const lang = languageOf(project.language)
  const system = [
    'You are a storyboard writer for faceless YouTube videos. For each numbered voice-over segment, write a short scene title and a story note.',
    'The story note is one concrete sentence of what is on screen: who or what, where, doing what. It must match the segment and the brief.',
    'Never describe the narration itself, as in "the narrator explains"; describe the picture.',
    factRule(brief),
    `Write in ${lang}. Return exactly one entry per segment, in order.`
  ].join(' ')
  const out: DraftScene[] = []
  for (let from = 0, g = 0; from < scenes.length; from += NOTES_GROUP, g++) {
    const slice = scenes.slice(from, from + NOTES_GROUP)
    let rows = pending.notes.get(g)
    if (!rows) {
      emit.storyProgress({ projectId: project.id, message: `Menyusun adegan ${from + 1}–${from + slice.length} dari ${scenes.length}` })
      const listed = slice.map((s, i) => `${from + i + 1}. [Act ${s.act + 1}: ${plan.acts[s.act].title}] ${s.narration}`).join('\n')
      const result = await generateJson<{ scenes?: { title?: string; story?: string }[] }>({
        system,
        prompt: `Brief:\n${briefText(brief)}\n\nVideo title: ${plan.title || project.title}\n\nSegments:\n${listed}`,
        schema: SCENE_NOTES_SCHEMA,
        name: `script-notes-${g + 1}`
      })
      rows = result.scenes ?? []
      pending.notes.set(g, rows)
    }
    slice.forEach((s, i) => out.push({ title: str(rows?.[i]?.title) || `Adegan ${from + i + 1}`, story: str(rows?.[i]?.story), narration: s.narration }))
  }
  return out
}

/** Rewrites one scene with its neighbours as context; shared by the review pass and the creator's revise action. */
async function rewriteScene(project: Project, brief: StoryBrief | null, scenes: DraftScene[], index: number, instruction: string): Promise<{ story: string; narration: string }> {
  const lang = languageOf(project.language)
  const scene = scenes[index]
  const from = Math.max(0, index - 1)
  const context = scenes.slice(from, index + 2).map((c, i) => `${from + i + 1}. ${c.title}\nStory: ${c.story}\nNarration: ${c.narration}`).join('\n\n')
  const plan = project.storyPlan
  const result = await generateJson<{ story?: string; narration?: string }>({
    system: [
      'You are a script editor revising one scene in a faceless YouTube video.',
      'Follow the instruction while preserving established facts, names, continuity, and the neighbouring scenes.',
      'Keep the narration natural to speak, flowing from the previous scene into the next, and close to the original length. Do not alter the rest of the story.',
      brief ? factRule(brief) : '',
      index === 0 && plan?.hook ? `This is the opening scene; its narration must still start with the exact hook: ${plan.hook}` : '',
      `Write the replacement story note and narration in ${lang}.`
    ].filter(Boolean).join(' '),
    prompt: [
      `Creator idea:\n${project.synopsis}`,
      brief && `Brief:\n${briefText(brief)}`,
      plan?.hook && `Opening hook: ${plan.hook}`,
      plan?.acts.length && `Reviewed outline:\n${outlineText(plan.acts)}`,
      `Context around the selected scene:\n${context}`,
      `Selected scene to revise:\n${index + 1}. ${scene.title}\nStory: ${scene.story}\nNarration: ${scene.narration}`,
      `Instruction: ${instruction}`
    ].filter(Boolean).join('\n\n'),
    schema: REVISED_SCENE_SCHEMA,
    name: 'revise-scene'
  })
  return { story: str(result.story), narration: str(result.narration) }
}

/** One editor pass that catches what drafting misses: absent brief points, repeats, and scenes that talk about the topic instead of delivering it. */
async function reviewScript(project: Project, plan: StoryPlan, brief: StoryBrief, scenes: DraftScene[]): Promise<void> {
  emit.storyProgress({ projectId: project.id, message: 'Memeriksa naskah…' })
  const listed = scenes.map((s, i) => `${i + 1}. ${s.title}: ${s.narration}`).join('\n')
  const result = await generateJson<{ issues?: { scene?: number; problem?: string; instruction?: string }[] }>({
    system: [
      'You are a story editor checking a finished faceless YouTube script against its brief.',
      'Flag only real problems: a must-cover point that is missing or only mentioned vaguely, a scene that repeats an earlier scene, a scene that drifts away from the brief or into an avoided direction, or a scene that talks about the topic from outside instead of delivering content.',
      'Also check for stiff spoken Indonesian, an opening that repeats the hook idea, a weak cause-and-effect transition between adjacent scenes, a hook with no later payoff, and scenes that do not deliver the reviewed outline beats.',
      factRule(brief),
      'For a missing point, choose the weakest or most repetitive scene where it fits and instruct the rewrite to deliver it there.',
      `Return at most ${MAX_REVIEW_FIXES} issues, most important first, and an empty list when the script is fine. Write problems and instructions in English.`
    ].join(' '),
    prompt: `Brief:\n${briefText(brief)}\n\nOutline:\n${outlineText(plan.acts)}\n\nScript:\n${listed}`,
    schema: REVIEW_SCHEMA,
    name: 'script-review'
  })
  const seen = new Set<number>()
  const fixes = (result.issues ?? [])
    .map((issue) => ({ index: Math.round(Number(issue.scene)) - 1, instruction: [str(issue.problem), str(issue.instruction)].filter(Boolean).join(' ') }))
    .filter((f) => f.index >= 0 && f.index < scenes.length && f.instruction && !seen.has(f.index) && seen.add(f.index))
    .slice(0, MAX_REVIEW_FIXES)
  for (let i = 0; i < fixes.length; i++) {
    emit.storyProgress({ projectId: project.id, message: `Merapikan adegan ${fixes[i].index + 1} (${i + 1} dari ${fixes.length})` })
    const scene = scenes[fixes[i].index]
    const revised = await rewriteScene(project, brief, scenes, fixes[i].index, `${fixes[i].instruction} Keep about ${wordCount(scene.narration)} spoken words.`)
    if (revised.narration) scenes[fixes[i].index] = { ...scene, story: revised.story || scene.story, narration: revised.narration }
  }
}

/**
 * Writes the script narration-first: each act as flowing prose, cut into scenes at sentence breaks, then
 * given on-screen notes and one review pass. Cutting already-written prose keeps the voice-over continuous,
 * which matters because narration.ts records it as one take.
 */
export async function generateScript(projectId: string): Promise<ProjectBundle> {
  const project = getProject(projectId)
  if (!project.synopsis.trim()) throw new Error('Tulis ide cerita atau sinopsis dulu.')
  const savedPlan = project.storyPlan
  if (!savedPlan?.hook.trim() || !savedPlan.acts.length) throw new Error('Pilih hook dan susun kerangka cerita dulu.')
  const brief = await briefFor(project)
  const plan: StoryPlan = { ...savedPlan, brief }
  const count = plan.acts.reduce((n, a) => n + a.scenes, 0) || clipCountFor(project.durationSec)
  const fingerprint = JSON.stringify([project.synopsis, project.durationSec, project.language, plan])
  let pending = pendingScripts.get(projectId)
  if (!pending || pending.fingerprint !== fingerprint) {
    pending = { fingerprint, drafts: new Map(), notes: new Map() }
    pendingScripts.set(projectId, pending)
  }
  // Spoken words that fill each scene's share of the target length, at the pace estimateNarrationMs assumes.
  const wordsPerScene = Math.max(8, (project.durationSec / count - 0.6) * 2.6)

  const drafts = await draftActs(project, plan, brief, pending, wordsPerScene)
  const cut = drafts.flatMap((text, act) => splitNarration(text, plan.acts[act].scenes).map((narration) => ({ act, narration })))
  const scenes = await writeSceneNotes(project, plan, brief, pending, cut)
  try {
    await reviewScript(project, plan, brief, scenes)
  } catch (e) {
    // The draft is already usable; a failed review should not cost the creator the whole script.
    console.warn('[story] script review skipped:', e instanceof Error ? e.message : e)
  }
  pendingScripts.delete(projectId)

  const kept = scenes.filter((c) => c.narration || c.story)
  if (!kept.length) throw new Error('Model tidak menghasilkan adegan. Coba lagi atau pilih model lain di Pengaturan.')
  replaceScript(
    projectId,
    plan.title || project.title,
    kept.map((c, i) => ({ title: c.title || `Adegan ${i + 1}`, story: c.story, narration: c.narration, durationMs: estimateNarrationMs(c.narration) }))
  )
  return getBundle(projectId)
}

/** Rewrites one scene with nearby context so edits still fit the brief, hook, and act outline. */
export async function reviseScene(projectId: string, clipId: string, instruction: string): Promise<{ story: string; narration: string }> {
  const project = getProject(projectId)
  const clips = clipsOf(projectId)
  const index = clips.findIndex((c) => c.id === clipId)
  if (index < 0) throw new Error('Adegan yang dipilih tidak ditemukan.')
  const request = str(instruction)
  if (!request) throw new Error('Tulis perubahan yang kamu inginkan dulu.')
  const brief = project.storyPlan?.brief ? normalizeBrief(project.storyPlan.brief) : null
  const scenes = clips.map((c) => ({ title: c.title, story: c.story, narration: c.narration }))
  const { story, narration } = await rewriteScene(project, brief, scenes, index, request)
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
