import * as React from 'react'
import { toast } from 'sonner'
import { CalendarClock, Ellipsis, FolderOpen, LoaderCircle, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
  EmptyState,
  Input,
  Skeleton,
  Switch,
  Textarea,
} from '@/components/ui'
import { Field, Page, PageHeader } from '@/components/page'
import { errorMessage, hermes, type Job } from '@/lib/api'
import { navigate, useApp } from '@/lib/store'
import { displayValue, formatDateTime, timeAgo } from '@/lib/utils'

const PRESETS = ['in 30m', 'every 1h', 'daily at 9am', 'weekdays at 9am', 'every monday 9am', '0 18 * * *']
const DELIVERY = ['local', 'origin', 'telegram', 'discord', 'slack', 'email', 'all']

const isPaused = (job: Job) => job.enabled === false || job.paused === true || job.state === 'paused'

export function SchedulesPage() {
  const { bot, bots } = useApp()
  const botHome = bots.find((b) => b.name === bot)?.home
  const [jobs, setJobs] = React.useState<Job[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<Job | 'new' | null>(null)

  const load = React.useCallback(async () => {
    try {
      const r = await hermes<Record<string, any>>(bot, 'api/jobs')
      setJobs(Array.isArray(r) ? r : (r.jobs ?? r.data ?? []))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [bot])

  React.useEffect(() => {
    load()
  }, [load])

  async function action(job: Job, verb: 'pause' | 'resume' | 'run' | 'delete') {
    try {
      if (verb === 'delete') await hermes(bot, `api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' })
      else await hermes(bot, `api/jobs/${encodeURIComponent(job.id)}/${verb}`, { method: 'POST' })
      toast.success({ pause: 'Paused', resume: 'Resumed', run: 'Started — output will appear in Files', delete: 'Deleted' }[verb])
      load()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Page>
      <PageHeader
        title="Schedules"
        description={<>Recurring and one-off jobs for <span className="font-medium text-foreground">{bot}</span>. Switch bots in the sidebar.</>}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
              <RefreshCw />
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> New schedule
            </Button>
          </>
        }
      />
      {error && <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      ) : !error && jobs.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="No schedules" description="Schedule prompts like “Every weekday at 8am, summarize my inbox and save it as a file.”" action={<Button onClick={() => setEditing('new')}><Plus /> New schedule</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {jobs.map((job) => {
            const paused = isPaused(job)
            return (
              <Card key={job.id} className="gap-4">
                <CardHeader>
                  <CardTitle className="truncate">{job.name || job.id}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="font-mono">{displayValue(job.schedule_display ?? job.schedule)}</Badge>
                    {paused ? <Badge variant="warning">paused</Badge> : <Badge variant="success">active</Badge>}
                    {job.last_status ? <Badge variant={String(job.last_status).includes('fail') || String(job.last_status).includes('error') ? 'destructive' : 'secondary'}>{displayValue(job.last_status)}</Badge> : null}
                  </CardDescription>
                  <CardAction className="flex items-center gap-1">
                    <Switch checked={!paused} onCheckedChange={(on) => action(job, on ? 'resume' : 'pause')} aria-label="Enabled" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Schedule actions">
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => action(job, 'run')}>
                          <Play /> Run now
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing(job)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        {botHome && (
                          <DropdownMenuItem onSelect={() => navigate('files', { path: `${botHome}/cron/output/${job.id}` })}>
                            <FolderOpen /> Outputs
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => action(job, 'delete')}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-3 text-sm text-muted-foreground">{displayValue(job.prompt)}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Next run</div>
                      <div>{formatDateTime(job.next_run_at) || '—'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last run</div>
                      <div>{timeAgo(job.last_run_at) || '—'}</div>
                    </div>
                  </div>
                  {job.last_error ? <p className="text-xs text-destructive">{displayValue(job.last_error)}</p> : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <JobDialog bot={bot} job={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load() }} />}
      </Dialog>
    </Page>
  )
}

function JobDialog({ bot, job, onDone }: { bot: string; job: Job | null; onDone: () => void }) {
  const [name, setName] = React.useState(job?.name ?? '')
  const [schedule, setSchedule] = React.useState(displayValue(job?.schedule_input ?? job?.schedule ?? ''))
  const [prompt, setPrompt] = React.useState(displayValue(job?.prompt ?? ''))
  const [deliver, setDeliver] = React.useState(displayValue(job?.deliver ?? 'local'))
  const [skills, setSkills] = React.useState(Array.isArray(job?.skills) ? (job.skills as string[]).join(', ') : '')
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const body: Record<string, unknown> = { name, schedule, prompt, deliver }
    const skillList = skills.split(',').map((s) => s.trim()).filter(Boolean)
    if (skillList.length) body.skills = skillList
    try {
      if (job) await hermes(bot, `api/jobs/${encodeURIComponent(job.id)}`, { method: 'PATCH', body })
      else await hermes(bot, 'api/jobs', { body })
      toast.success(job ? 'Schedule updated' : 'Schedule created')
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
        <DialogTitle>{job ? 'Edit schedule' : 'New schedule'}</DialogTitle>
        <DialogDescription>The bot runs the prompt on schedule with all of its tools. Files it saves appear in Files.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning AI news brief" autoFocus />
        </Field>
        <Field label="When" hint="Natural language, intervals, cron or ISO time — e.g. “every 2h”, “weekdays at 9am”, “0 9 * * *”.">
          <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="daily at 8am" className="font-mono" />
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button type="button" key={p} onClick={() => setSchedule(p)}>
                <Badge variant={schedule === p ? 'default' : 'outline'} className="cursor-pointer font-mono">{p}</Badge>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Prompt">
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="Find the 5 most important AI news stories from the last 24 hours and save a short brief to ~/hermes-workspace/briefs/." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deliver to" hint="local = save only">
            <Input value={deliver} onChange={(e) => setDeliver(e.target.value)} list="hc-deliver" />
            <datalist id="hc-deliver">
              {DELIVERY.map((d) => <option key={d} value={d} />)}
            </datalist>
          </Field>
          <Field label="Skills" hint="Comma separated, optional">
            <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="web-research" />
          </Field>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={!name.trim() || !schedule.trim() || !prompt.trim() || busy}>
            {busy && <LoaderCircle className="animate-spin" />} {job ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
