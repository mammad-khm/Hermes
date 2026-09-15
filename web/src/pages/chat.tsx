import * as React from 'react'
import { toast } from 'sonner'
import { ArrowUp, Bot as BotIcon, CircleAlert, Cpu, Ellipsis, FolderOpen, History, LoaderCircle, Paperclip, Pencil, Plus, Square, Trash2, Wrench, X } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  SheetContent,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { CopyButton } from '@/components/page'
import { api, errorMessage, hermes, storage, streamChat, uploadFile, type HermesMessage, type HermesSession } from '@/lib/api'
import { navigate, useApp } from '@/lib/store'
import { cn, readAsDataUrl, timeAgo } from '@/lib/utils'

type ToolEvent = { id: string; name: string; preview?: string; status: 'running' | 'done' | 'failed' }
type ChatItem = { id: string; role: 'user' | 'assistant'; content: string; tools: ToolEvent[]; streaming?: boolean; thinking?: boolean; error?: string }
type ModelChoice = { provider: string; model: string }

let seq = 0
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        const p = part as Record<string, any>
        if (p.type === 'text' || p.type === 'input_text' || p.type === 'output_text') return p.text ?? ''
        const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url
        return url ? `![image](${url})` : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return content && typeof content === 'object' ? JSON.stringify(content) : ''
}

function toolNames(calls: unknown): string[] {
  if (!Array.isArray(calls)) return []
  return calls.map((c) => String((c as any)?.function?.name ?? (c as any)?.name ?? 'tool'))
}

function messagesToItems(messages: HermesMessage[]): ChatItem[] {
  const items: ChatItem[] = []
  let pending: ToolEvent[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const text = contentToText(m.content)
      if (text) items.push({ id: String(m.id ?? uid()), role: 'user', content: text, tools: [] })
      pending = []
    } else if (m.role === 'assistant') {
      pending.push(...toolNames(m.tool_calls).map((name) => ({ id: uid(), name, status: 'done' as const })))
      const text = contentToText(m.content)
      if (text.trim()) {
        items.push({ id: String(m.id ?? uid()), role: 'assistant', content: text, tools: pending })
        pending = []
      }
    }
  }
  if (pending.length) items.push({ id: uid(), role: 'assistant', content: '', tools: pending })
  return items
}

const readModel = (bot: string): ModelChoice | null => {
  try {
    return JSON.parse(storage.get(`hc-model-${bot}`) ?? 'null')
  } catch {
    return null
  }
}

const SUGGESTIONS = ['Plan my week and create tasks for the important items', 'Research a topic and save a report as a Markdown file', 'Summarize the newest files in my workspace', 'Every morning at 8am, send me a news brief about AI']

export function ChatPage() {
  const { bot, bots, info } = useApp()
  const botInfo = bots.find((b) => b.name === bot)
  const [sessions, setSessions] = React.useState<HermesSession[]>([])
  const [sessionsLoading, setSessionsLoading] = React.useState(true)
  const [sessionsError, setSessionsError] = React.useState<string | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(() => storage.get(`hc-chat-${bot}`))
  const [items, setItems] = React.useState<ChatItem[]>([])
  const [loadingMessages, setLoadingMessages] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [model, setModel] = React.useState<ModelChoice | null>(() => readModel(bot))
  const [modelDialog, setModelDialog] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [renaming, setRenaming] = React.useState<HermesSession | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const skipLoadRef = React.useRef(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const stickRef = React.useRef(true)

  const loadSessions = React.useCallback(async () => {
    try {
      const r = await hermes<{ data?: HermesSession[] }>(bot, 'api/sessions?limit=100')
      setSessions(r.data ?? [])
      setSessionsError(null)
    } catch (e) {
      setSessionsError(errorMessage(e))
    } finally {
      setSessionsLoading(false)
    }
  }, [bot])

  React.useEffect(() => {
    loadSessions()
  }, [loadSessions])

  React.useEffect(() => {
    storage.set(`hc-chat-${bot}`, activeId)
    if (!activeId) {
      setItems([])
      return
    }
    if (skipLoadRef.current) {
      skipLoadRef.current = false
      return
    }
    let cancelled = false
    setLoadingMessages(true)
    hermes<{ data?: HermesMessage[] }>(bot, `api/sessions/${encodeURIComponent(activeId)}/messages`)
      .then((r) => {
        if (!cancelled) {
          setItems(messagesToItems(r.data ?? []))
          stickRef.current = true
        }
      })
      .catch((e) => {
        if (cancelled) return
        if (e?.status === 404) setActiveId(null)
        else toast.error(errorMessage(e))
      })
      .finally(() => !cancelled && setLoadingMessages(false))
    return () => {
      cancelled = true
    }
  }, [bot, activeId])

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  function onScroll() {
    const el = scrollRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  function chooseModel(choice: ModelChoice | null) {
    setModel(choice)
    storage.set(`hc-model-${bot}`, choice ? JSON.stringify(choice) : null)
  }

  function newChat() {
    if (sending) abortRef.current?.abort()
    setActiveId(null)
    setItems([])
    setHistoryOpen(false)
  }

  async function send(text: string, files: File[]) {
    const trimmed = text.trim()
    if (sending || (!trimmed && !files.length)) return
    setSending(true)
    const controller = new AbortController()
    abortRef.current = controller
    const assistantId = uid()
    const patch = (fn: (it: ChatItem) => ChatItem) => setItems((prev) => prev.map((it) => (it.id === assistantId ? fn(it) : it)))

    try {
      let messageText = trimmed
      let displayText = trimmed
      const imageParts: unknown[] = []
      if (files.length) {
        if (!info?.workspace) throw new Error('Workspace folder is unknown — check the Commands page.')
        const dir = `${info.workspace}/${bot}/uploads`
        await api('/files/mkdir', { body: { path: dir } })
        const saved: string[] = []
        for (const file of files) {
          const r = await uploadFile(dir, file)
          saved.push(r.entry.path)
          if (file.type.startsWith('image/') && file.size < 8 * 1024 * 1024) imageParts.push({ type: 'image_url', image_url: { url: await readAsDataUrl(file) } })
        }
        messageText = `${trimmed}\n\nI uploaded these files to the server:\n${saved.map((p) => `- ${p}`).join('\n')}`.trim()
        displayText = `${trimmed}\n\n${saved.map((p) => `\`${p}\``).join(' ')}`.trim()
      }

      setItems((prev) => [...prev, { id: uid(), role: 'user', content: displayText, tools: [] }, { id: assistantId, role: 'assistant', content: '', tools: [], streaming: true }])
      stickRef.current = true

      let sessionId = activeId
      if (!sessionId) {
        const created = await hermes<Record<string, any>>(bot, 'api/sessions', { body: { title: (trimmed || files[0]?.name || 'New chat').slice(0, 80) } })
        sessionId = String(created.id ?? created.session?.id ?? created.session_id)
        skipLoadRef.current = true
        setActiveId(sessionId)
      }

      const body: Record<string, unknown> = { message: imageParts.length ? [{ type: 'text', text: messageText }, ...imageParts] : messageText }
      if (model?.model) {
        body.model = model.model
        if (model.provider) body.provider = model.provider
      }

      await streamChat(
        bot,
        sessionId,
        body,
        ({ event, data }) => {
          switch (event) {
            case 'assistant.delta':
              patch((it) => ({ ...it, content: it.content + (data.delta ?? ''), thinking: false }))
              break
            case 'tool.started':
              patch((it) => ({ ...it, thinking: false, tools: [...it.tools, { id: uid(), name: data.tool_name ?? 'tool', preview: data.preview ?? undefined, status: 'running' }] }))
              break
            case 'tool.completed':
            case 'tool.failed':
              patch((it) => {
                const tools = [...it.tools]
                const idx = tools.findLastIndex((t) => t.status === 'running' && (!data.tool_name || t.name === data.tool_name))
                if (idx >= 0) tools[idx] = { ...tools[idx], status: event === 'tool.failed' ? 'failed' : 'done' }
                return { ...it, tools }
              })
              break
            case 'tool.progress':
              if (data.tool_name === '_thinking') patch((it) => ({ ...it, thinking: true }))
              break
            case 'assistant.completed':
              if (typeof data.content === 'string' && data.content) patch((it) => ({ ...it, content: data.content }))
              break
            case 'error':
              patch((it) => ({ ...it, error: String(data.message ?? 'Something went wrong') }))
              break
          }
        },
        controller.signal,
      )
    } catch (e) {
      const stopped = (e as Error).name === 'AbortError'
      const message = stopped ? 'Stopped' : errorMessage(e)
      setItems((prev) => (prev.some((it) => it.id === assistantId) ? prev.map((it) => (it.id === assistantId ? { ...it, error: message } : it)) : prev))
      if (!stopped) toast.error(message)
      if (!stopped && !trimmed && !files.length) setDraft(text)
    } finally {
      patch((it) => ({ ...it, streaming: false, thinking: false, tools: it.tools.map((t) => (t.status === 'running' ? { ...t, status: 'done' } : t)) }))
      setSending(false)
      abortRef.current = null
      loadSessions()
    }
  }

  async function deleteSession(s: HermesSession) {
    try {
      await hermes(bot, `api/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' })
      if (s.id === activeId) newChat()
      setSessions((prev) => prev.filter((x) => x.id !== s.id))
      toast.success('Chat deleted')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function renameSession(s: HermesSession, title: string) {
    try {
      await hermes(bot, `api/sessions/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: { title } })
      setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, title } : x)))
      setRenaming(null)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const activeTitle = sessions.find((s) => s.id === activeId)?.title
  const sessionList = (
    <SessionList
      sessions={sessions}
      loading={sessionsLoading}
      error={sessionsError}
      activeId={activeId}
      onSelect={(id) => {
        setActiveId(id)
        setHistoryOpen(false)
      }}
      onNew={newChat}
      onDelete={deleteSession}
      onRename={setRenaming}
    />
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 border-r lg:block">{sessionList}</aside>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="p-0 pt-[env(safe-area-inset-top)]" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Chat history</DialogTitle>
          {sessionList}
        </SheetContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:h-14 md:px-4">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setHistoryOpen(true)} aria-label="Chat history">
            <History />
          </Button>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-sm font-medium">{activeTitle || (activeId ? 'Chat' : 'New chat')}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setModelDialog(true)} className="max-w-[45vw]">
            <Cpu />
            <span className="truncate">{model?.model || botInfo?.model || 'Default model'}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={newChat} aria-label="New chat">
            <Plus />
          </Button>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {loadingMessages ? (
              <div className="space-y-6">
                <Skeleton className="ml-auto h-10 w-2/3" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="ml-auto h-10 w-1/2" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-6 pt-[8vh] text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                  <BotIcon className="size-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">What should {bot} work on?</h2>
                  <p className="text-sm text-muted-foreground">Files your bot creates show up as links here and in Files.</p>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => setDraft(s)} className="rounded-xl border px-4 py-3 text-left text-sm transition-colors hover:bg-accent">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {items.map((item) => (
                  <MessageView key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>

        <Composer draft={draft} setDraft={setDraft} sending={sending} onSend={send} onStop={() => abortRef.current?.abort()} />
      </div>

      <Dialog open={modelDialog} onOpenChange={setModelDialog}>
        <ModelDialog bot={bot} initial={model} fallback={botInfo ? { provider: botInfo.provider, model: botInfo.model } : null} onSave={(c) => { chooseModel(c); setModelDialog(false) }} />
      </Dialog>
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        {renaming && <RenameDialog session={renaming} onSave={(t) => renameSession(renaming, t)} />}
      </Dialog>
    </div>
  )
}

function SessionList(props: {
  sessions: HermesSession[]
  loading: boolean
  error: string | null
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (s: HermesSession) => void
  onRename: (s: HermesSession) => void
}) {
  const [query, setQuery] = React.useState('')
  const visible = props.sessions.filter((s) => !query || `${s.title ?? ''} ${s.preview ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <Button onClick={props.onNew} className="w-full justify-start" variant="outline">
          <Plus /> New chat
        </Button>
        <Input placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8" />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {props.loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mx-1 my-1 h-12" />)}
        {props.error && <p className="px-2 py-3 text-xs text-destructive">{props.error}</p>}
        {!props.loading && !props.error && visible.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No chats yet</p>}
        {visible.map((s) => (
          <div key={s.id} className={cn('group flex items-center rounded-md', s.id === props.activeId ? 'bg-accent' : 'hover:bg-accent/60')}>
            <button onClick={() => props.onSelect(s.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
              <div className="truncate text-sm">{s.title || s.preview || 'Untitled chat'}</div>
              <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                {s.source && s.source !== 'api_server' && <span className="capitalize">{s.source} ·</span>}
                {timeAgo(s.last_active ?? s.started_at)}
              </div>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="mr-1 opacity-60 group-hover:opacity-100" aria-label="Chat actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => props.onRename(s)}>
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(s)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </div>
  )
}

function MessageView({ item }: { item: ChatItem }) {
  if (item.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5">
          <Markdown>{item.content}</Markdown>
        </div>
      </div>
    )
  }
  const running = item.tools.filter((t) => t.status === 'running')
  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
        <BotIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {item.tools.length > 0 && (
          <details className="rounded-lg border bg-muted/30 text-xs" open={running.length > 0}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground select-none">
              {running.length ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
              {running.length ? `Running ${running[running.length - 1].name}…` : `Used ${item.tools.length} tool${item.tools.length > 1 ? 's' : ''}`}
            </summary>
            <div className="space-y-1 border-t px-3 py-2">
              {item.tools.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <span className={cn('size-1.5 shrink-0 rounded-full', t.status === 'running' ? 'animate-pulse bg-warning' : t.status === 'failed' ? 'bg-destructive' : 'bg-success')} />
                  <span className="font-mono">{t.name}</span>
                  {t.preview && <span className="truncate text-muted-foreground">{t.preview}</span>}
                </div>
              ))}
            </div>
          </details>
        )}
        {item.content ? (
          <Markdown>{item.content}</Markdown>
        ) : (
          item.streaming && (
            <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> {item.thinking ? 'Thinking…' : 'Working…'}
            </div>
          )
        )}
        {item.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {item.error}
          </div>
        )}
        {!item.streaming && item.content && (
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
            <CopyButton text={item.content} />
          </div>
        )}
      </div>
    </div>
  )
}

function Composer({ draft, setDraft, sending, onSend, onStop }: { draft: string; setDraft: (v: string) => void; sending: boolean; onSend: (text: string, files: File[]) => void; onStop: () => void }) {
  const [files, setFiles] = React.useState<File[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)

  function submit() {
    if (sending || (!draft.trim() && !files.length)) return
    onSend(draft, files)
    setDraft('')
    setFiles([])
  }

  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border bg-background shadow-sm focus-within:ring-[3px] focus-within:ring-ring/30 dark:bg-input/20">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {files.map((f, i) => (
                <Badge key={`${f.name}-${i}`} variant="secondary" className="gap-1 py-1">
                  <Paperclip /> <span className="max-w-40 truncate">{f.name}</span>
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(min-width: 768px)').matches) {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files)
              if (pasted.length) setFiles((prev) => [...prev, ...pasted])
            }}
            placeholder="Message your bot…"
            rows={1}
            className="max-h-52 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
            <Button variant="ghost" size="icon-sm" onClick={() => fileRef.current?.click()} aria-label="Attach files">
              <Paperclip />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('files')} className="text-muted-foreground">
              <FolderOpen /> Files
            </Button>
            <div className="flex-1" />
            {sending ? (
              <Button size="icon-sm" variant="secondary" onClick={onStop} aria-label="Stop">
                <Square className="fill-current" />
              </Button>
            ) : (
              <Button size="icon-sm" onClick={submit} disabled={!draft.trim() && !files.length} aria-label="Send" className="rounded-full">
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ModelDialog({ bot, initial, fallback, onSave }: { bot: string; initial: ModelChoice | null; fallback: ModelChoice | null; onSave: (c: ModelChoice | null) => void }) {
  const [value, setValue] = React.useState<ModelChoice>(initial ?? fallback ?? { provider: '', model: '' })
  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Model for this chat</DialogTitle>
        <DialogDescription>Overrides the bot's default model for messages you send from this device. Change the default on the Bots page.</DialogDescription>
      </DialogHeader>
      <ModelPicker bot={bot} provider={value.provider} model={value.model} onChange={setValue} />
      <DialogFooter>
        <Button variant="outline" onClick={() => onSave(null)}>
          Use bot default
        </Button>
        <Button onClick={() => onSave(value.model ? value : null)}>Save</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function RenameDialog({ session, onSave }: { session: HermesSession; onSave: (title: string) => void }) {
  const [title, setTitle] = React.useState(session.title ?? '')
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename chat</DialogTitle>
      </DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); onSave(title.trim()) }} className="grid gap-4">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <DialogFooter>
          <Button type="submit" disabled={!title.trim()}>Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
