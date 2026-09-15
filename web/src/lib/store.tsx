import * as React from 'react'
import { api, errorMessage, storage, type Bot, type SystemInfo } from './api'

/* Theme */
export type Theme = 'light' | 'dark' | 'system'
type ThemeState = { theme: Theme; resolved: 'light' | 'dark'; setTheme: (t: Theme) => void }
const ThemeContext = React.createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => (storage.get('hc-theme') as Theme) || 'system')
  const [systemDark, setSystemDark] = React.useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  React.useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', resolved === 'dark' ? '#0a0a0a' : '#ffffff')
  }, [resolved])

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t)
    storage.set('hc-theme', t)
  }, [])

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

/* Hash routing: #/page?key=value */
export type Route = { page: string; params: URLSearchParams }

function parseHash(): Route {
  const [page, query] = location.hash.replace(/^#\/?/, '').split('?')
  return { page: page || 'chat', params: new URLSearchParams(query || '') }
}

export function useRoute() {
  const [route, setRoute] = React.useState(parseHash)
  React.useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(page: string, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  location.hash = `#/${page}${query}`
}

/* App data */
type AppState = {
  bots: Bot[]
  botsLoading: boolean
  botsError: string | null
  refreshBots: () => Promise<void>
  bot: string
  setBot: (name: string) => void
  info: SystemInfo | null
  refreshInfo: () => Promise<void>
}
const AppContext = React.createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [bots, setBots] = React.useState<Bot[]>([])
  const [botsLoading, setBotsLoading] = React.useState(true)
  const [botsError, setBotsError] = React.useState<string | null>(null)
  const [bot, setBotState] = React.useState(() => storage.get('hc-bot') || 'default')
  const [info, setInfo] = React.useState<SystemInfo | null>(null)

  const refreshBots = React.useCallback(async () => {
    try {
      const r = await api<{ bots: Bot[] }>('/bots')
      setBots(r.bots)
      setBotsError(null)
    } catch (e) {
      setBotsError(errorMessage(e))
    } finally {
      setBotsLoading(false)
    }
  }, [])

  const refreshInfo = React.useCallback(async () => {
    try {
      setInfo(await api<SystemInfo>('/system/info'))
    } catch {
      /* shown on the Commands page */
    }
  }, [])

  React.useEffect(() => {
    refreshBots()
    refreshInfo()
  }, [refreshBots, refreshInfo])

  const setBot = React.useCallback((name: string) => {
    setBotState(name)
    storage.set('hc-bot', name)
  }, [])

  React.useEffect(() => {
    if (bots.length && !bots.some((b) => b.name === bot)) setBot('default')
  }, [bots, bot, setBot])

  return <AppContext.Provider value={{ bots, botsLoading, botsError, refreshBots, bot, setBot, info, refreshInfo }}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = React.useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
