import * as React from 'react'
import { toast } from 'sonner'
import { Bot as BotIcon, Cpu, Ellipsis, KeyRound, LoaderCircle, MessageSquare, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui'
import { ModelPicker } from '@/components/model-picker'
import { CodeBlock, Field, Page, PageHeader } from '@/components/page'
import { api, errorMessage, type Bot } from '@/lib/api'
import { navigate, useApp } from '@/lib/store'

const PROVIDER_KEYS = [
  ['OPENROUTER_API_KEY', 'OpenRouter'],
  ['ANTHROPIC_API_KEY', 'Anthropic'],
  ['OPENAI_API_KEY', 'OpenAI'],
  ['GEMINI_API_KEY', 'Google Gemini'],
  ['XAI_API_KEY', 'xAI'],
  ['DEEPSEEK_API_KEY', 'DeepSeek'],
  ['GROQ_API_KEY', 'Groq'],
  ['MINIMAX_API_KEY', 'MiniMax'],
  ['KIMI_API_KEY', 'Kimi'],
  ['GLM_API_KEY', 'GLM / Z.ai'],
  ['DASHSCOPE_API_KEY', 'Qwen (DashScope)'],
  ['TAVILY_API_KEY', 'Tavily (web search)'],
  ['FIRECRAWL_API_KEY', 'Firecrawl (web)'],
  ['ELEVENLABS_API_KEY', 'ElevenLabs (voice)'],
] as const

export function BotsPage() {
  const { bots, botsLoading, botsError, refreshBots, setBot, info } = useApp()
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<Bot | null>(null)

  return (
    <Page>
      <PageHeader
        title="Bots"
        description="Each bot is a Hermes profile with its own model, personality, memory, skills and API keys."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New bot
          </Button>
        }
      />

      {info && !info.multiplex_profiles && bots.length > 1 && (
        <Card className="mb-6 border-warning/50 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-base">Turn on multi-bot routing to chat with every bot</CardTitle>
            <CardDescription>Your Hermes gateway currently only serves the default bot. Run this on the server once:</CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={'hermes config set gateway.multiplex_profiles true\nhermes gateway restart'} />
          </CardContent>
        </Card>
      )}

      {botsError && <p className="mb-4 text-sm text-destructive">{botsError}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {botsLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        {bots.map((b) => (
          <Card key={b.name} className="gap-4">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <BotIcon className="size-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="truncate">{b.name}</CardTitle>
                  <CardDescription className="truncate">{b.is_default ? 'Default bot' : 'Profile'}</CardDescription>
                </div>
              </div>
              <CardAction>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Bot actions">
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(b.name)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    {!b.is_default && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(b)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardAction>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
              <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{b.description || 'No description yet.'}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="max-w-full">
                  <Cpu /> <span className="truncate">{b.model || 'model not set'}</span>
                </Badge>
                {b.provider && <Badge variant="secondary">{b.provider}</Badge>}
                {b.has_soul && (
                  <Badge variant="secondary">
                    <Sparkles /> personality
                  </Badge>
                )}
                {b.secrets.length > 0 && (
                  <Badge variant="secondary">
                    <KeyRound /> {b.secrets.length} keys
                  </Badge>
                )}
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setBot(b.name)
                  navigate('chat')
                }}
              >
                <MessageSquare /> Chat
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(b.name)}>
                <Pencil /> Edit
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <CreateBotDialog onDone={() => { setCreating(false); refreshBots() }} />}
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EditBotDialog name={editing} onChanged={refreshBots} />}
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        {deleting && <DeleteBotDialog bot={deleting} onDone={() => { setDeleting(null); refreshBots() }} />}
      </Dialog>
    </Page>
  )
}

function CreateBotDialog({ onDone }: { onDone: () => void }) {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [clone, setClone] = React.useState(true)
  const [model, setModel] = React.useState({ provider: '', model: '' })
  const [soul, setSoul] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const validName = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/bots', { body: { name, description, clone, soul, ...model } })
      toast.success(`Bot “${name}” created`)
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>New bot</DialogTitle>
        <DialogDescription>Creates a new Hermes profile. Its working folder is created in your workspace so its files show up in Files.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint="Lowercase letters, numbers, - and _">
            <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="researcher" autoCapitalize="off" autoFocus aria-invalid={!!name && !validName} />
          </Field>
          <Field label="Role description" hint="Helps Hermes route Kanban tasks to this bot.">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Researches topics and writes reports" />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Copy settings from the default bot</div>
            <div className="text-xs text-muted-foreground">Copies config, API keys, skills and personality. Chats and schedules start empty.</div>
          </div>
          <Switch checked={clone} onCheckedChange={setClone} />
        </label>
        <div className="grid gap-2">
          <div className="text-sm font-medium">AI model</div>
          <ModelPicker bot="default" provider={model.provider} model={model.model} onChange={setModel} />
        </div>
        <Field label="Personality (SOUL.md)" hint="Optional. How this bot should think, talk and work.">
          <Textarea value={soul} onChange={(e) => setSoul(e.target.value)} rows={4} placeholder="You are a meticulous research assistant. Always cite sources and save reports as Markdown files." />
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={!validName || busy}>
            {busy && <LoaderCircle className="animate-spin" />} Create bot
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function EditBotDialog({ name, onChanged }: { name: string; onChanged: () => void }) {
  const [bot, setBot] = React.useState<Bot | null>(null)
  const [model, setModel] = React.useState({ provider: '', model: '' })
  const [soul, setSoul] = React.useState('')
  const [cwd, setCwd] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const b = await api<Bot>(`/bots/${name}`)
      setBot(b)
      setModel({ provider: b.provider, model: b.model })
      setSoul(b.soul ?? '')
      setCwd(b.cwd)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }, [name])

  React.useEffect(() => {
    load()
  }, [load])

  async function save(section: string, body: Record<string, unknown>) {
    setBusy(section)
    try {
      const b = await api<Bot>(`/bots/${name}`, { method: 'PATCH', body })
      setBot((prev) => ({ ...b, soul: prev?.soul }))
      toast.success('Saved')
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Edit {name}</DialogTitle>
        <DialogDescription>{bot?.home}</DialogDescription>
      </DialogHeader>
      {!bot ? (
        <Skeleton className="h-64" />
      ) : (
        <Tabs defaultValue="model" className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="model">Model</TabsTrigger>
            <TabsTrigger value="personality">Personality</TabsTrigger>
            <TabsTrigger value="keys">API keys</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
          </TabsList>

          <TabsContent value="model" className="space-y-4">
            <ModelPicker bot={name} provider={model.provider} model={model.model} onChange={setModel} />
            <DialogFooter>
              <Button onClick={() => save('model', model)} disabled={!model.model || busy === 'model'}>
                {busy === 'model' && <LoaderCircle className="animate-spin" />} Save model
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="personality" className="space-y-4">
            <Textarea value={soul} onChange={(e) => setSoul(e.target.value)} rows={12} className="font-mono text-xs" placeholder="Describe this bot's personality, tone and working style…" />
            <DialogFooter>
              <Button onClick={() => save('soul', { soul })} disabled={busy === 'soul'}>
                {busy === 'soul' && <LoaderCircle className="animate-spin" />} Save personality
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="keys">
            <SecretsEditor bot={bot} onUpdated={(b) => { setBot((prev) => ({ ...b, soul: prev?.soul })); onChanged() }} />
          </TabsContent>

          <TabsContent value="workspace" className="space-y-4">
            <Field label="Working directory" hint="Where this bot runs commands and saves files. Folders inside your workspace appear in Files automatically.">
              <Input value={cwd} onChange={(e) => setCwd(e.target.value)} className="font-mono" />
            </Field>
            <DialogFooter>
              <Button onClick={() => save('cwd', { cwd })} disabled={!cwd.startsWith('/') || busy === 'cwd'}>
                {busy === 'cwd' && <LoaderCircle className="animate-spin" />} Save
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      )}
    </DialogContent>
  )
}

function SecretsEditor({ bot, onUpdated }: { bot: Bot; onUpdated: (b: Bot) => void }) {
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [customKey, setCustomKey] = React.useState('')
  const [extraKeys, setExtraKeys] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const known = new Set<string>(PROVIDER_KEYS.map(([k]) => k))
  const custom = [...new Set([...bot.secrets, ...extraKeys])].filter((k) => !known.has(k))
  const rows: (readonly [string, string])[] = [...PROVIDER_KEYS, ...custom.map((k) => [k, k] as const)]

  async function put(key: string, value: string) {
    setBusy(key)
    try {
      const b = await api<Bot>(`/bots/${bot.name}/secrets`, { method: 'PUT', body: { key, value } })
      onUpdated(b)
      setValues((v) => ({ ...v, [key]: '' }))
      toast.success(value ? `${key} saved` : `${key} removed`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Keys are written to this bot's .env on the server and are never shown again. Restart the gateway if a provider does not pick up a new key.</p>
      <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {rows.map(([key, label]) => {
          const isSet = bot.secrets.includes(key)
          return (
            <div key={key} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{key}</div>
              </div>
              <Input type="password" placeholder={isSet ? '•••••••• (set)' : 'Not set'} value={values[key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} autoComplete="off" />
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => put(key, values[key] ?? '')} disabled={!values[key] || busy === key}>
                  Save
                </Button>
                {isSet && (
                  <Button size="sm" variant="ghost" onClick={() => put(key, '')} disabled={busy === key}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        <Input placeholder="OTHER_VARIABLE_NAME" value={customKey} onChange={(e) => setCustomKey(e.target.value.toUpperCase())} className="font-mono" />
        <Button variant="outline" disabled={!/^[A-Z][A-Z0-9_]{1,63}$/.test(customKey)} onClick={() => { setExtraKeys((keys) => [...keys, customKey]); setCustomKey('') }}>
          Add variable
        </Button>
      </div>
    </div>
  )
}

function DeleteBotDialog({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete {bot.name}?</DialogTitle>
        <DialogDescription>This removes the profile with its memory, chats, skills and schedules from the server. Files in its workspace folder are kept. This cannot be undone.</DialogDescription>
      </DialogHeader>
      <Field label={`Type “${bot.name}” to confirm`}>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="off" />
      </Field>
      <DialogFooter>
        <Button
          variant="destructive"
          disabled={confirm !== bot.name || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await api(`/bots/${bot.name}`, { method: 'DELETE' })
              toast.success(`${bot.name} deleted`)
              onDone()
            } catch (e) {
              toast.error(errorMessage(e))
              setBusy(false)
            }
          }}
        >
          {busy && <LoaderCircle className="animate-spin" />} Delete bot
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
