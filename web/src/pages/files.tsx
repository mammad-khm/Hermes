import * as React from 'react'
import { toast } from 'sonner'
import { ChevronRight, Download, Ellipsis, Eye, File, FileImage, FileText, Folder, FolderPlus, LoaderCircle, RefreshCw, Trash2, Upload } from 'lucide-react'
import {
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { Markdown } from '@/components/markdown'
import { Page, PageHeader } from '@/components/page'
import { api, errorMessage, fileUrl, uploadFile, type FileEntry, type FileRoot } from '@/lib/api'
import { useRoute } from '@/lib/store'
import { cn, formatBytes, timeAgo } from '@/lib/utils'

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|toml|ini|xml|html?|css|js|jsx|ts|tsx|py|sh|sql|env|rs|go|java|rb|php|c|cpp|h)$/i

function iconFor(entry: FileEntry) {
  if (entry.type === 'dir') return <Folder className="size-4 text-blue-500" />
  if (entry.mime?.startsWith('image/')) return <FileImage className="size-4 text-violet-500" />
  if (TEXT_EXT.test(entry.name)) return <FileText className="size-4 text-muted-foreground" />
  return <File className="size-4 text-muted-foreground" />
}

export function FilesPage() {
  const route = useRoute()
  const initialPath = route.params.get('path') ?? ''
  const [tab, setTab] = React.useState(initialPath ? 'browse' : 'recent')
  const [roots, setRoots] = React.useState<FileRoot[]>([])
  const [path, setPath] = React.useState(initialPath)
  const [entries, setEntries] = React.useState<FileEntry[]>([])
  const [recent, setRecent] = React.useState<FileEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<FileEntry | null>(null)
  const [deleting, setDeleting] = React.useState<FileEntry | null>(null)
  const [newFolder, setNewFolder] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const uploadRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    api<{ roots: FileRoot[] }>('/files/roots')
      .then((r) => {
        setRoots(r.roots)
        setPath((p) => p || r.roots[0]?.path || '')
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const loadDir = React.useCallback(async () => {
    if (!path) return
    setLoading(true)
    try {
      const r = await api<{ entries?: FileEntry[]; entry?: FileEntry; path?: string }>(`/files?path=${encodeURIComponent(path)}&sort=recent`)
      if (r.entry) {
        setPreview(r.entry)
        setPath(r.entry.path.slice(0, r.entry.path.lastIndexOf('/')) || '/')
        return
      }
      setEntries(r.entries ?? [])
      setError(null)
    } catch (e) {
      setEntries([])
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  const loadRecent = React.useCallback(async () => {
    setLoading(true)
    try {
      setRecent((await api<{ entries: FileEntry[] }>('/files/recent?limit=150')).entries)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (tab === 'browse') loadDir()
    else loadRecent()
  }, [tab, loadDir, loadRecent])

  const root = roots.filter((r) => path === r.path || path.startsWith(`${r.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]
  const crumbs = root ? path.slice(root.path.length).split('/').filter(Boolean) : []

  async function onUpload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) await uploadFile(path, f)
      toast.success(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`)
      loadDir()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const list = tab === 'browse' ? entries : recent

  return (
    <Page>
      <PageHeader
        title="Files"
        description="Everything your bots create — reports, images, code and schedule outputs."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={() => (tab === 'browse' ? loadDir() : loadRecent())} aria-label="Refresh">
              <RefreshCw />
            </Button>
            {tab === 'browse' && (
              <>
                <Button variant="outline" onClick={() => setNewFolder(true)}>
                  <FolderPlus /> Folder
                </Button>
                <input ref={uploadRef} type="file" multiple hidden onChange={(e) => { onUpload(e.target.files); e.target.value = '' }} />
                <Button onClick={() => uploadRef.current?.click()} disabled={uploading || !path}>
                  {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />} Upload
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="browse">Browse</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === 'browse' && roots.length > 0 && (
          <Select value={root?.path} onValueChange={setPath}>
            <SelectTrigger className="sm:w-64">
              <SelectValue placeholder="Choose a folder" />
            </SelectTrigger>
            <SelectContent>
              {roots.map((r) => (
                <SelectItem key={r.path} value={r.path} disabled={!r.exists}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {tab === 'browse' && root && (
        <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
          <button className="rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => setPath(root.path)}>
            {root.label}
          </button>
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <button className="rounded px-1.5 py-0.5 hover:bg-accent" onClick={() => setPath(`${root.path}/${crumbs.slice(0, i + 1).join('/')}`)}>
                {c}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {error && <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : list.length === 0 && !error ? (
        <EmptyState icon={<Folder />} title={tab === 'recent' ? 'No files yet' : 'This folder is empty'} description="Ask a bot to create a report or file and it will appear here." />
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {list.map((entry) => (
            <div key={entry.path} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
              <button
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => {
                  if (entry.type === 'dir') {
                    setTab('browse')
                    setPath(entry.path)
                  } else setPreview(entry)
                }}
              >
                {iconFor(entry)}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{entry.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {tab === 'recent' ? entry.path : entry.type === 'dir' ? 'Folder' : formatBytes(entry.size)}
                  </div>
                </div>
              </button>
              <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:block">{timeAgo(entry.mtime)}</span>
              {entry.type === 'file' && (
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href={fileUrl(entry.path, true)} aria-label={`Download ${entry.name}`}>
                    <Download />
                  </a>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="File actions">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {entry.type === 'file' && (
                    <DropdownMenuItem onSelect={() => setPreview(entry)}>
                      <Eye /> Preview
                    </DropdownMenuItem>
                  )}
                  {entry.type === 'file' && (
                    <DropdownMenuItem asChild>
                      <a href={fileUrl(entry.path)} target="_blank" rel="noreferrer">
                        <File /> Open in new tab
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(entry)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && <PreviewDialog entry={preview} />}
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        {deleting && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {deleting.name}?</DialogTitle>
              <DialogDescription>{deleting.type === 'dir' ? 'The folder and everything inside it will be permanently deleted from the server.' : 'The file will be permanently deleted from the server.'}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await api(`/files?path=${encodeURIComponent(deleting.path)}`, { method: 'DELETE' })
                    toast.success('Deleted')
                    setDeleting(null)
                    if (tab === 'browse') loadDir()
                    else loadRecent()
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={newFolder} onOpenChange={setNewFolder}>
        {newFolder && <NewFolderDialog parent={path} onDone={() => { setNewFolder(false); loadDir() }} />}
      </Dialog>
    </Page>
  )
}

function NewFolderDialog({ parent, onDone }: { parent: string; onDone: () => void }) {
  const [name, setName] = React.useState('')
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New folder</DialogTitle>
        <DialogDescription className="font-mono text-xs break-all">{parent}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await api('/files/mkdir', { body: { path: `${parent}/${name.trim()}` } })
            onDone()
          } catch (err) {
            toast.error(errorMessage(err))
          }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="reports" autoFocus />
        <DialogFooter>
          <Button type="submit" disabled={!name.trim() || name.includes('/')}>Create</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function PreviewDialog({ entry }: { entry: FileEntry }) {
  const mime = entry.mime ?? ''
  const url = fileUrl(entry.path)
  const isText = TEXT_EXT.test(entry.name) || mime.startsWith('text/')
  const [text, setText] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isText || entry.size > 2 * 1024 * 1024) return
    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Could not load file.'))
  }, [url, isText, entry.size])

  let body: React.ReactNode
  if (mime.startsWith('image/')) body = <img src={url} alt={entry.name} className="mx-auto max-h-[65vh] rounded-lg" />
  else if (mime.startsWith('video/')) body = <video src={url} controls className="max-h-[65vh] w-full rounded-lg" />
  else if (mime.startsWith('audio/')) body = <audio src={url} controls className="w-full" />
  else if (mime === 'application/pdf') body = <iframe src={url} title={entry.name} className="h-[65vh] w-full rounded-lg border" />
  else if (isText && entry.size <= 2 * 1024 * 1024)
    body =
      text === null ? (
        <Skeleton className="h-64" />
      ) : /\.(md|markdown)$/i.test(entry.name) ? (
        <div className="max-h-[65vh] overflow-auto rounded-lg border p-4"><Markdown>{text}</Markdown></div>
      ) : (
        <pre className="max-h-[65vh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{text}</pre>
      )
  else body = <p className="py-10 text-center text-sm text-muted-foreground">No preview for this file type. Download it to open it.</p>

  return (
    <DialogContent className="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle className="truncate pr-6">{entry.name}</DialogTitle>
        <DialogDescription className="font-mono text-xs break-all">{entry.path} · {formatBytes(entry.size)}</DialogDescription>
      </DialogHeader>
      <div className={cn('min-w-0')}>{body}</div>
      <DialogFooter>
        <Button variant="outline" asChild>
          <a href={url} target="_blank" rel="noreferrer">Open</a>
        </Button>
        <Button asChild>
          <a href={fileUrl(entry.path, true)}>
            <Download /> Download
          </a>
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
