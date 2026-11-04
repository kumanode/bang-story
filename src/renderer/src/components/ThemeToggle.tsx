import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../lib/theme'
import { IconButton } from './ui'

export function ThemeToggle({ className }: { className?: string }) {
  const { activeTheme, toggle } = useTheme()
  const isDark = activeTheme === 'dark'
  const label = isDark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'

  return (
    <IconButton label={label} onClick={toggle} className={className}>
      {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </IconButton>
  )
}
