import * as React from 'react'
import { toast } from 'sonner'
import { CircleCheck, CircleX, LoaderCircle, Play, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { CodeBlock, Page, PageHeader } from '@/components/page'
import { api, errorMessage, getSession } from '@/lib/api'
import { useApp } from '@/lib/store'

const ACTIONS = [
  { action: 'status', label: 'Gateway status', hint: 'hermes gateway status' },
  { action: 'restart', label: 'Restart gateway', hint: 'hermes gateway restart' },
  { action: 'doctor', label: 'Run doctor', hint: 'hermes doctor' },
  { action: 'profiles', label: 'List profiles', hint: 'hermes profile list' },
  { action: 'version', label: 'Version', hint: 'hermes --version' },
  { action: 'update', label: 'Update Hermes', hint: 'hermes update' },
]

const SECTIONS: { title: string; description: string; blocks: { label?: string; code: string }[] }[] = [
  {
    title: '1. Enable the Hermes API server',
    description: 'Hermes Console talks to Hermes through its built-in API server. Run once on the server where Hermes is installed.',
    blocks: [
      {
        code: `grep -q '^API_SERVER_KEY=' ~/.hermes/.env || echo "API_SERVER_KEY=$(openssl rand -hex 32)" >> ~/.hermes/.env
grep -q '^API_SERVER_ENABLED=' ~/.hermes/.env || echo "API_SERVER_ENABLED=true" >> ~/.hermes/.env
hermes config set gateway.multiplex_profiles true
hermes gateway restart
curl -s http://127.0.0.1:8642/health`,
      },
    ],
  },
  {
    title: '2. Install Hermes Console',
    description: 'Copy the hermes-console.tar.gz package to the server, then set your username and password. No build step is needed on the server.',
    blocks: [
      { label: 'On your computer', code: 'scp hermes-console.tar.gz USER@YOUR_SERVER:~/' },
      {
        label: 'On the server',
        code: `mkdir -p ~/hermes-console && tar -xzf ~/hermes-console.tar.gz -C ~/hermes-console
cd ~/hermes-console
python3 server/hermes_console.py init
bash deploy/install-service.sh`,
      },
      { label: 'Logs & control', code: 'sudo systemctl status hermes-console\nsudo journalctl -u hermes-console -f\nsudo systemctl restart hermes-console' },
    ],
  },
  {
    title: '3. Put it behind HTTPS',
    description: 'Required for installing the app on your phone and to keep your password safe. Point a domain at the server, then use Caddy:',
    blocks: [
      {
        code: `sudo apt install -y caddy
echo 'console.example.com {
  reverse_proxy 127.0.0.1:8787
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy`,
      },
      { label: 'Then keep the console private to Caddy', code: `sed -i 's/^CONSOLE_HOST=.*/CONSOLE_HOST=127.0.0.1/' ~/hermes-console/server/console.env\nsudo systemctl restart hermes-console` },
    ],
  },
  {
    title: 'Bots (profiles)',
    description: 'Everything on the Bots page, from the terminal.',
    blocks: [
      {
        code: `hermes profile list
hermes profile create researcher --clone --description "Researches topics and writes reports"
hermes -p researcher model                      # interactive model/provider picker
hermes -p researcher config set model.default anthropic/claude-sonnet-4
hermes -p researcher config set model.provider openrouter
nano ~/.hermes/profiles/researcher/SOUL.md       # personality
nano ~/.hermes/profiles/researcher/.env          # API keys
hermes profile delete researcher --yes`,
      },
    ],
  },
  {
    title: 'Tasks (Kanban)',
    description: 'Tasks are picked up by the dispatcher inside the running gateway.',
    blocks: [
      {
        code: `hermes kanban create "Write a market report" --assignee researcher --body "Save it to ~/hermes-workspace/reports"
hermes kanban list
hermes kanban show <id>
hermes kanban comment <id> "Focus on 2026 data"
hermes kanban complete <id> --result "Done"
hermes kanban watch`,
      },
    ],
  },
  {
    title: 'Schedules & troubleshooting',
    description: 'Schedules can also be created by simply asking a bot in chat, e.g. “every weekday at 8am…”.',
    blocks: [
      {
        code: `ls ~/.hermes/cron/output/            # schedule outputs
hermes gateway status
hermes doctor
hermes update
sudo systemctl restart hermes-console`,
      },
    ],
  },
]

function Check({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CircleCheck className="size-4 shrink-0 text-success" /> : <CircleX className="size-4 shrink-0 text-destructive" />}
      {label}
    </div>
  )
}

export function CommandsPage() {
  const { info, refreshInfo } = useApp()
  const [running, setRunning] = React.useState<string | null>(null)
  const [output, setOutput] = React.useState<{ action: string; exit_code: number; output: string } | null>(null)
  const server = getSession()?.server ?? ''

  async function run(action: string) {
    setRunning(action)
    try {
      setOutput(await api('/system/run', { body: { action } }))
      if (action === 'restart') setTimeout(refreshInfo, 4000)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRunning(null)
    }
  }

  return (
    <Page>
      <PageHeader title="Commands" description="Server health, one-click maintenance, and every command you need to set things up." />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Server status</CardTitle>
            <CardDescription className="break-all">{server}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {info ? (
              <>
                <Check ok={info.api_health.reachable} label={info.api_health.reachable ? `Hermes API reachable (${info.hermes_api})` : `Hermes API not reachable — is the gateway running?`} />
                <Check ok={info.api_key_configured} label="API_SERVER_KEY configured" />
                <Check ok={info.multiplex_profiles} label="Multi-bot routing (multiplex_profiles)" />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="outline">console {info.console_version}</Badge>
                  <Badge variant="outline" className="max-w-full truncate font-mono">{info.workspace}</Badge>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            <Button variant="outline" size="sm" onClick={refreshInfo}>
              <RefreshCw /> Re-check
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run on server</CardTitle>
            <CardDescription>Safe, predefined maintenance commands.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {ACTIONS.map((a) => (
                <Button key={a.action} variant="outline" className="h-auto flex-col items-start gap-0.5 py-2 text-left" onClick={() => run(a.action)} disabled={!!running}>
                  <span className="flex items-center gap-1.5">
                    {running === a.action ? <LoaderCircle className="animate-spin" /> : <Play />} {a.label}
                  </span>
                  <span className="font-mono text-[10px] font-normal text-muted-foreground">{a.hint}</span>
                </Button>
              ))}
            </div>
            {output && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">
                  {output.action} · exit code {output.exit_code}
                </div>
                <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] whitespace-pre-wrap">{output.output || '(no output)'}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {section.blocks.map((b, i) => (
                <div key={i} className="space-y-1.5">
                  {b.label && <div className="text-xs font-medium text-muted-foreground">{b.label}</div>}
                  <CodeBlock code={b.code} />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  )
}
