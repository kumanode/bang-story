import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENTS, type StudioApi } from '../shared/api'

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args)

const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

const api: StudioApi = {
  projects: {
    list: call('projects:list'),
    create: call('projects:create'),
    get: call('projects:get'),
    save: call('projects:save'),
    remove: call('projects:remove'),
    duplicate: call('projects:duplicate'),
    setCover: call('projects:setCover')
  },
  story: {
    chapterPlan: call('story:chapterPlan'),
    styleProfile: call('story:styleProfile'),
    brief: call('story:brief'),
    hooks: call('story:hooks'),
    outline: call('story:outline'),
    script: call('story:script'),
    reviseScene: call('story:reviseScene'),
    visuals: call('story:visuals'),
    musicPrompt: call('story:musicPrompt'),
    youtubeMetadata: call('story:youtubeMetadata'),
    thumbnailConcept: call('story:thumbnailConcept')
  },
  generate: {
    thumbnail: call('generate:thumbnail'),
    clipImage: call('generate:clipImage'),
    clipVideo: call('generate:clipVideo'),
    clipTts: call('generate:clipTts'),
    characterSheet: call('generate:characterSheet'),
    missingImages: call('generate:missingImages'),
    missingVideos: call('generate:missingVideos'),
    clipsVideo: call('generate:clipsVideo'),
    clipLipSync: call('generate:clipLipSync'),
    clipsLipSync: call('generate:clipsLipSync'),
    missingTts: call('generate:missingTts'),
    narration: call('generate:narration'),
    syncCaptions: call('generate:syncCaptions'),
    cancel: call('generate:cancel'),
    cancelProject: call('generate:cancelProject'),
    estimate: call('generate:estimate')
  },
  clips: {
    split: call('clips:split'),
    detachVoice: call('clips:detachVoice')
  },
  assets: {
    setActive: call('assets:setActive'),
    setWords: call('assets:setWords'),
    pickMusic: call('assets:pickMusic'),
    pickImage: call('assets:pickImage'),
    listBuiltinSfx: call('assets:listBuiltinSfx'),
    addBuiltinSfx: call('assets:addBuiltinSfx'),
    pickSfx: call('assets:pickSfx'),
    importSfx: call('assets:importSfx'),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    replaceClipMedia: call('assets:replaceClipMedia')
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
    keys: call('settings:keys'),
    setKey: call('settings:setKey'),
    setCustom: call('settings:setCustom'),
    setFlow2Api: call('settings:setFlow2Api'),
    clearKey: call('settings:clearKey'),
    revealKey: call('settings:revealKey'),
    testKey: call('settings:testKey'),
    voices: call('settings:voices')
  },
  models: {
    list: call('models:list')
  },
  exporter: {
    start: call('export:start'),
    nvencAvailable: call('export:nvencAvailable'),
    defaultFolder: call('export:defaultFolder'),
    pickFolder: call('export:pickFolder'),
    reveal: call('export:reveal'),
    saveThumbnail: call('export:saveThumbnail'),
    saveClipThumbnail: call('export:saveClipThumbnail')
  },
  app: {
    openExternal: call('app:openExternal'),
    copyText: call('app:copyText'),
    version: call('app:version')
  },
  whisper: {
    status: call('whisper:status'),
    download: call('whisper:download'),
    cancel: call('whisper:cancel'),
    remove: call('whisper:remove'),
    openFolder: call('whisper:openFolder')
  },
  on: {
    storyProgress: listen(EVENTS.storyProgress),
    whisper: listen(EVENTS.whisper),
    job: listen(EVENTS.job),
    clip: listen(EVENTS.clip),
    character: listen(EVENTS.character),
    asset: listen(EVENTS.asset)
  }
}

contextBridge.exposeInMainWorld('api', api)
