import * as React from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@/components/ui'
import { defaultServer, errorMessage, login } from '@/lib/api'
import { Logo, ThemeToggle } from '@/App'

export function LoginPage() {
  const [server, setServer] = React.useState(defaultServer)
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(server, username.trim(), password)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40 px-4 pt-[env(safe-area-inset-top)] dark:bg-background">
      <div className="flex justify-end py-3">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center pb-16">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <Logo className="size-11" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Hermes Console</h1>
              <p className="text-sm text-muted-foreground">Chat with your bots, assign tasks, and get your files.</p>
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Use the server URL and the account you set up with the console.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="server">Server URL</Label>
                  <Input id="server" type="url" inputMode="url" placeholder="https://console.example.com" value={server} onChange={(e) => setServer(e.target.value)} autoCapitalize="off" autoCorrect="off" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" autoComplete="username" autoCapitalize="off" value={username} onChange={(e) => setUsername(e.target.value)} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {error && (
                  <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy && <LoaderCircle className="animate-spin" />}
                  Sign in
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
