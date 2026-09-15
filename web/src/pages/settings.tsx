import { LogOut, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { Page, PageHeader } from '@/components/page'
import { getSession, setSession } from '@/lib/api'
import { useTheme, type Theme } from '@/lib/store'
import { cn, formatDateTime } from '@/lib/utils'

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const session = getSession()

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose light, dark, or follow your device.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button key={value} onClick={() => setTheme(value)} className={cn('flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors hover:bg-accent', theme === value && 'border-primary ring-1 ring-primary')}>
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Signed in as <span className="font-medium text-foreground">{session?.username}</span> on <span className="break-all">{session?.server}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Session valid until {formatDateTime(session?.expiresAt)}</span>
            <Button variant="outline" onClick={() => setSession(null)}>
              <LogOut /> Sign out
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-4" /> Install on your phone
            </CardTitle>
            <CardDescription>Hermes Console works like a native app — full screen, with its own icon — without an app store.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="font-medium">iPhone / iPad:</span> open this site in Safari → Share → <em>Add to Home Screen</em>.
            </p>
            <p>
              <span className="font-medium">Android:</span> open in Chrome → ⋮ menu → <em>Install app</em>.
            </p>
            <p className="text-muted-foreground">Requires the console to be served over HTTPS (see Commands → step 3).</p>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
