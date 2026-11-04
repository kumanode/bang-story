import { create } from 'zustand'
import type { ActiveTheme, ThemePreference } from '@shared/types'

const STORAGE_KEY = 'studio-theme'

function getSavedPreference(): ThemePreference {
  try {
    const val = localStorage.getItem(STORAGE_KEY)
    if (val === 'light' || val === 'dark' || val === 'system') return val
  } catch {
    // Ignore storage access errors.
  }
  return 'system'
}

function resolveActiveTheme(pref: ThemePreference): ActiveTheme {
  if (pref === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref
}

export function applyThemeClass(active: ActiveTheme): void {
  if (typeof document === 'undefined') return
  if (active === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

interface ThemeState {
  theme: ThemePreference
  activeTheme: ActiveTheme
  setTheme: (theme: ThemePreference) => void
  toggle: () => void
  init: () => () => void
}

const initialPref = getSavedPreference()
const initialActive = resolveActiveTheme(initialPref)
applyThemeClass(initialActive)

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initialPref,
  activeTheme: initialActive,
  setTheme: (nextPref: ThemePreference) => {
    const nextActive = resolveActiveTheme(nextPref)
    try {
      localStorage.setItem(STORAGE_KEY, nextPref)
    } catch {
      // Ignore storage access errors.
    }
    applyThemeClass(nextActive)
    set({ theme: nextPref, activeTheme: nextActive })
    void window.api?.settings?.set({ theme: nextPref }).catch(() => {
      // Settings might not be available in test/early environments.
    })
  },
  toggle: () => {
    const { activeTheme } = get()
    const nextPref: ThemePreference = activeTheme === 'dark' ? 'light' : 'dark'
    get().setTheme(nextPref)
  },
  init: () => {
    // Sync with saved settings from SQLite if present.
    void window.api?.settings?.get().then((s) => {
      if (s?.theme && (s.theme === 'light' || s.theme === 'dark' || s.theme === 'system')) {
        const current = get().theme
        if (current !== s.theme) {
          get().setTheme(s.theme)
        }
      }
    }).catch(() => {
      // Ignore IPC errors.
    })

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onMediaChange = (): void => {
      if (get().theme === 'system') {
        const nextActive = resolveActiveTheme('system')
        applyThemeClass(nextActive)
        set({ activeTheme: nextActive })
      }
    }
    mql.addEventListener('change', onMediaChange)
    return () => mql.removeEventListener('change', onMediaChange)
  }
}))
