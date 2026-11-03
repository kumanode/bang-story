import type { BuiltinSfx } from './types'

export const BUILTIN_SFX: BuiltinSfx[] = [
  { id: 'whoosh', name: 'Whoosh', fileName: 'whoosh.wav', durationMs: 600, description: 'Transisi cepat / swish sinematik' },
  { id: 'boom', name: 'Deep Boom', fileName: 'boom.wav', durationMs: 1500, description: 'Dentuman sub-bass dramatis' },
  { id: 'riser', name: 'Cinematic Riser', fileName: 'riser.wav', durationMs: 2000, description: 'Ketegangan audio naik' },
  { id: 'knock', name: 'Ketukan Pintu', fileName: 'knock.wav', durationMs: 800, description: 'Ketukan kayu dua kali' },
  { id: 'thunder', name: 'Gemuruh Petir', fileName: 'thunder.wav', durationMs: 2500, description: 'Suara petir & guntur mendalam' },
  { id: 'bell', name: 'Lonceng Misteri', fileName: 'bell.wav', durationMs: 2000, description: 'Denting lonceng kuno' },
  { id: 'glitch', name: 'Digital Glitch', fileName: 'glitch.wav', durationMs: 500, description: 'Distorsi sinyal digital' }
]
