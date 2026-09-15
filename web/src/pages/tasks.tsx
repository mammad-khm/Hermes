import * as React from 'react'
import { toast } from 'sonner'
import { Archive, Ban, CircleCheck, LoaderCircle, Play, Plus, RefreshCw, ScrollText, Send, SquareKanban, UserRound, Zap } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
} from '@/components/ui'
import { Markdown } from '@/components/markdown'
import { Field, Page, PageHeader } from '@/components/page'
import { api, errorMessage, type Task } from '@/lib/api'
import { useApp } from '@/lib/store'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'

const COLUMNS: { key: string; label: string; dot: string }[] = [
  { key: 'triage', label: 'Triage', dot: 'bg-muted-foreground' },
  { key: 'todo', label: 'To do', dot: 'bg-muted-foreground' },
  { key: 'ready', label: 'Ready', dot: 'bg-blue-500' },
  { key: 'running', label: 'Running', dot: 'bg-warning' },
  { key: 'review', label: 'Review', dot: 'bg-violet-500' },
  { key: 'blocked', label: 'Blocked', dot: 'bg-destructive' },
  { key: 'done', label: 'Done', dot: 'bg-success' },
]
const NONE = '__none'

export function TasksPage() {
  const { bots } = useApp()
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [assignee, setAssignee] = React.useState('all')
  const [creating, setCreating] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const r = await api<{ tasks: Task[] }>('/tasks')
      setTasks(r.tasks)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 10000)
    return () => clearInterval(timer)
  }, [load])

  async function nudge() {
    try {
      await api('/tasks/dispatch', { method: 'POST' })
      toast.success('Dispatcher nudged')
      load()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const visible = tasks.filter((t) => t.status !== 'archived' && (assignee === 'all' || (assignee === NONE ? !t.assignee : t.assignee === assignee)))
  const known = new Set(COLUMNS.map((c) => c.key))
  const columns = [...COLUMNS, ...(visible.some((t) => !known.has(t.status)) ? [{ key: '__other', label: 'Other', dot: 'bg-muted-foreground' }] : [])]

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Tasks"
        description="A shared Kanban board. Assign a task to a bot and Hermes works on it in the background."
        actions={
          <>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All bots</SelectItem>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {bots.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
              <RefreshCw />
            </Button>
            <Button variant="outline" onClick={nudge}>
              <Zap /> Nudge
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New task
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-80 w-72 shrink-0 rounded-xl" />)}
        </div>
      ) : !error && tasks.length === 0 ? (
        <EmptyState icon={<SquareKanban />} title="No tasks yet" description="Create a task, assign it to a bot, and track its progress here." action={<Button onClick={() => setCreating(true)}><Plus /> New task</Button>} />
      ) : (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
          {columns.map((col) => {
            const colTasks = visible.filter((t) => (col.key === '__other' ? !known.has(t.status) : t.status === col.key)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            return (
              <div key={col.key} className="flex w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-xl bg-muted/50 sm:w-72">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className={cn('size-2 rounded-full', col.dot)} />
                  <span className="text-sm font-medium">{col.label}</span>
                  <span className="text-xs text-muted-foreground">{colTasks.length}</span>
                </div>
                <div className="space-y-2 px-2 pb-2">
                  {colTasks.map((t) => (
                    <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-ring/50">
                      <div className="line-clamp-3 text-sm font-medium">{t.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {t.assignee ? (
                          <Badge variant="secondary">
                            <UserRound /> {t.assignee}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">unassigned</Badge>
                        )}
                        {!!t.priority && <Badge variant="outline">P{t.priority}</Badge>}
                        <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(t.created_at)}</span>
                      </div>
                    </button>
                  ))}
                  {colTasks.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">Empty</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <CreateTaskDialog onDone={() => { setCreating(false); load() }} />}
      </Dialog>
      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        {openId && <TaskDialog id={openId} onChanged={load} />}
      </Dialog>
    </Page>
  )
}

function CreateTaskDialog({ onDone }: { onDone: () => void }) {
  const { bots, bot } = useApp()
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [assignee, setAssignee] = React.useState(bot)
  const [priority, setPriority] = React.useState('0')
  const [triage, setTriage] = React.useState(false)
  const [goal, setGoal] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/tasks', { body: { title, body, assignee: triage || assignee === NONE ? '' : assignee, priority: Number(priority), triage, goal } })
      toast.success('Task created')
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>New task</DialogTitle>
        <DialogDescription>Describe the outcome you want. The assigned bot picks it up automatically while the gateway is running.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Write a competitor analysis for our product" autoFocus />
        </Field>
        <Field label="Details" hint="Context, acceptance criteria, where to save files…">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assign to">
            <Select value={assignee} onValueChange={setAssignee} disabled={triage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {bots.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Normal</SelectItem>
                <SelectItem value="1">High</SelectItem>
                <SelectItem value="2">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Let Hermes plan it (triage)</div>
            <div className="text-xs text-muted-foreground">Breaks a big idea into sub-tasks and routes them to the best bots.</div>
          </div>
          <Switch checked={triage} onCheckedChange={setTriage} />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Goal mode</div>
            <div className="text-xs text-muted-foreground">The bot keeps working over multiple turns until the goal is met.</div>
          </div>
          <Switch checked={goal} onCheckedChange={setGoal} />
        </label>
        <DialogFooter>
          <Button type="submit" disabled={!title.trim() || busy}>
            {busy && <LoaderCircle className="animate-spin" />} Create task
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function TaskDialog({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { bots } = useApp()
  const [detail, setDetail] = React.useState<Record<string, any> | null>(null)
  const [comment, setComment] = React.useState('')
  const [note, setNote] = React.useState('')
  const [log, setLog] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const r = await api<{ task: Record<string, any> }>(`/tasks/${id}`)
      setDetail(r.task)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }, [id])

  React.useEffect(() => {
    load()
  }, [load])

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(action)
    try {
      await api(`/tasks/${id}/${action}`, { body })
      await load()
      onChanged()
      if (action === 'comment') setComment('')
      else setNote('')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const task: Record<string, any> = detail?.task ?? detail ?? {}
  const comments: Record<string, any>[] = detail?.comments ?? task.comments ?? []
  const events: Record<string, any>[] = detail?.events ?? task.events ?? []

  return (
    <DialogContent className="sm:max-w-2xl">
      {!detail ? (
        <>
          <DialogTitle className="sr-only">Loading task</DialogTitle>
          <Skeleton className="h-72" />
        </>
      ) : (
        <>
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2 pr-6">
              <Badge variant="outline" className="font-mono">{String(task.id ?? id)}</Badge>
              <Badge>{String(task.status ?? '')}</Badge>
              {task.created_at && <span className="text-xs text-muted-foreground">Created {formatDateTime(task.created_at)}</span>}
            </div>
            <DialogTitle className="text-left leading-snug">{String(task.title ?? '')}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assigned bot">
              <Select value={task.assignee || NONE} onValueChange={(v) => act('assign', { assignee: v === NONE ? 'none' : v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {bots.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {task.last_failure_error && (
              <Field label="Last error">
                <p className="text-sm text-destructive">{String(task.last_failure_error)}</p>
              </Field>
            )}
          </div>

          {task.body && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-medium">Details</h3>
              <div className="rounded-lg border p-3"><Markdown>{String(task.body)}</Markdown></div>
            </section>
          )}
          {task.result && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-medium">Result</h3>
              <div className="rounded-lg border border-success/30 bg-success/5 p-3"><Markdown>{String(task.result)}</Markdown></div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Actions</h3>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional result summary or block reason" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => act('promote')} disabled={!!busy}>
                <Play /> Mark ready
              </Button>
              <Button size="sm" variant="outline" onClick={() => act('complete', { text: note })} disabled={!!busy}>
                <CircleCheck /> Complete
              </Button>
              {task.status === 'blocked' ? (
                <Button size="sm" variant="outline" onClick={() => act('unblock')} disabled={!!busy}>
                  <Ban /> Unblock
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => act('block', { text: note })} disabled={!!busy}>
                  <Ban /> Block
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => act('archive')} disabled={!!busy}>
                <Archive /> Archive
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    setLog((await api<{ log: string }>(`/tasks/${id}/log`)).log || 'No worker log yet.')
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              >
                <ScrollText /> Worker log
              </Button>
            </div>
            {log !== null && <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] whitespace-pre-wrap">{log}</pre>}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Comments</h3>
            {comments.length === 0 && <p className="text-xs text-muted-foreground">No comments. Comments are visible to the bot working on this task.</p>}
            <div className="space-y-2">
              {comments.map((c, i) => (
                <div key={String(c.id ?? i)} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{String(c.author ?? 'unknown')}</span>
                    {timeAgo(c.created_at)}
                  </div>
                  <Markdown>{String(c.body ?? c.text ?? '')}</Markdown>
                </div>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (comment.trim()) act('comment', { text: comment }) }} className="flex gap-2">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add guidance for the bot…" />
              <Button type="submit" size="icon" disabled={!comment.trim() || busy === 'comment'} aria-label="Send comment">
                <Send />
              </Button>
            </form>
          </section>

          {events.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Activity ({events.length})</summary>
              <div className="mt-2 space-y-1">
                {events.slice(-20).map((ev, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="shrink-0 text-muted-foreground">{timeAgo(ev.created_at ?? ev.ts)}</span>
                    <span className="font-mono">{String(ev.kind ?? ev.type ?? '')}</span>
                    <span className="truncate text-muted-foreground">{typeof ev.payload === 'string' ? ev.payload : ''}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <DialogFooter />
        </>
      )}
    </DialogContent>
  )
}
