export type ExportFrameRate = 30 | 60

export function frameRateFromStorage(value: string | null): ExportFrameRate {
  return value === '60' ? 60 : 30
}

export function frameDuration(rate: ExportFrameRate): number {
  return 1 / rate
}
