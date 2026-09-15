import * as React from 'react'
import { Toaster } from 'sonner'
import { Bot as BotIcon, CalendarClock, FolderOpen, LogOut, Menu, MessageSquare, Monitor, Moon, Settings, SquareKanban, Sun, Terminal } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SheetContent,
} from '@/components/ui'
import { getSession, setSession } from '@/lib/api'
import { AppProvider, ThemeProvider, navigate, useApp, useRoute, useTheme } from '@/lib/store'
import { cn } from '@/lib/utils'
import { LoginPage } from '@/pages/login'
import { ChatPage } from '@/pages/chat'
import { BotsPage } from '@/pages/bots'
import { TasksPage } from '@/pages/tasks'
import { SchedulesPage } from '@/pages/schedules'
import { FilesPage } from '@/pages/files'
import { CommandsPage } from '@/pages/commands'
import { SettingsPage } from '@/pages/settings'

const NAV = [
  { page: 'chat', label: 'Chat', icon: MessageSquare },
  { page: 'tasks', label: 'Tasks', icon: SquareKanban },
  { page: 'schedules', label: 'Schedules', icon: CalendarClock },
  { page: 'files', label: 'Files', icon: FolderOpen },
  { page: 'bots', label: 'Bots', icon: BotIcon },
  { page: 'commands', label: 'Commands', icon: Terminal },
  { page: 'settings', label: 'Settings', icon: Settings },
] as const

export default function App() {
  const [session, setSessionState] = React.useState(getSession)
  React.useEffect(() => {
    const onAuth = () => setSessionState(getSession())
    window.addEventListener('hc-auth', onAuth)
    return () => window.removeEventListener('hc-auth', onAuth)
  }, [])

  return (
    <ThemeProvider>
      {session ? (
        <AppProvider key={session.token}>
          <Shell />
        </AppProvider>
      ) : (
        <LoginPage />
      )}
      <ThemedToaster />
    </ThemeProvider>
  )
}

function ThemedToaster() {
  const { resolved } = useTheme()
  return <Toaster theme={resolved} position="top-center" richColors closeButton />
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground', className)}>
      <svg viewBox="0 0 24 24" className="size-[60%]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4v16M17 4v16M7 12h10" />
        <path d="M3 7c1.5-1 3-1 4 0M21 7c-1.5-1-3-1-4 0" />
      </svg>
    </div>
  )
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarBody({ current }: { current: string }) {
  const { bots, bot, setBot } = useApp()
  const session = getSession()
  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">Hermes Console</div>
          <div className="truncate text-xs text-muted-foreground">{session?.server.replace(/^https?:\/\//, '')}</div>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Active bot</div>
        <Select value={bot} onValueChange={setBot}>
          <SelectTrigger className="bg-background">
            <SelectValue placeholder="Choose a bot" />
          </SelectTrigger>
          <SelectContent>
            {(bots.length ? bots : [{ name: 'default', model: '' }]).map((b) => (
              <SelectItem key={b.name} value={b.name}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.map(({ page, label, icon: Icon }) => (
          <button
            key={page}
            onClick={() => navigate(page)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              current === page ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-1 border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left hover:bg-sidebar-accent">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">{session?.username.slice(0, 1)}</div>
              <span className="truncate text-sm">{session?.username}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Signed in as {session?.username}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('settings')}>
              <Settings /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setSession(null)}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>
    </div>
  )
}

function Shell() {
  const route = useRoute()
  const { bot } = useApp()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const page = NAV.some((n) => n.page === route.page) ? route.page : 'chat'
  const label = NAV.find((n) => n.page === page)?.label

  React.useEffect(() => setMenuOpen(false), [route])

  const content = {
    chat: <ChatPage key={bot} />,
    tasks: <TasksPage />,
    schedules: <SchedulesPage key={bot} />,
    files: <FilesPage key={route.params.get('path') ?? ''} />,
    bots: <BotsPage />,
    commands: <CommandsPage />,
    settings: <SettingsPage />,
  }[page]

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <SidebarBody current={page} />
      </aside>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="bg-sidebar p-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <SidebarBody current={page} />
        </SheetContent>
      </Dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-2 px-2">
            <Button variant="ghost" size="icon" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Menu />
            </Button>
            <span className="font-semibold">{label}</span>
            <span className="truncate text-sm text-muted-foreground">· {bot}</span>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{content}</main>
      </div>
    </div>
  )
}
