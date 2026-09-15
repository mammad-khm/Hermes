export type AuthSession = { server: string; token: string; username: string; expiresAt: number }

export type Bot = {
  name: string
  is_default: boolean
  home: string
  description: string
  model: string
  provider: string
  base_url: string
  cwd: string
  has_soul: boolean
  secrets: string[]
  api_key_configured: boolean
  soul?: string
}

export type SystemInfo = {
  console_version: string
  hermes_home: string
  hermes_bin: string
  hermes_api: string
  api_health: { reachable: boolean; status?: number; error?: string }
  workspace: string
  multiplex_profiles: boolean
  api_key_configured: boolean
}

export type HermesSession = {
  id: string
  title?: string | null
  source?: string
  model?: string | null
  started_at?: number | string
  last_active?: number | string
  message_count?: number
  preview?: string | null
}

export type HermesMessage = {
  id?: string | number
  role: string
  content: unknown
  tool_calls?: unknown
  tool_name?: string
  timestamp?: number | string
}

export type FileEntry = { name: string; path: string; type: 'dir' | 'file' | 'missing'; size: number; mtime: number; mime?: string | null }
export type FileRoot = { label: string; path: string; exists: boolean }

export type Task = {
  id: string
  title: string
  body?: string | null
  assignee?: string | null
  status: string
  priority?: number | null
  created_at?: number | null
  completed_at?: number | null
  result?: string | null
  [key: string]: unknown
}

export type Job = { id: string; name?: string; [key: string]: unknown }

export class ApiError extends Error {
  status: number
  details: string
  constructor(status: number, message: string, details = '') {
    super(message)
    this.status = status
    this.details = details
  }
}

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      /* storage unavailable */
    }
  },
}

const SESSION_KEY = 'hc-session'

function loadSession(): AuthSession | null {
  const raw = storage.get(SESSION_KEY)
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as AuthSession
    if (!s.token || s.expiresAt * 1000 < Date.now()) return null
    return s
  } catch {
    return null
  }
}

let current = loadSession()

export const getSession = () => current

export function setSession(session: AuthSession | null) {
  current = session
  storage.set(SESSION_KEY, session ? JSON.stringify(session) : null)
  window.dispatchEvent(new Event('hc-auth'))
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

export function normalizeServer(input: string) {
  let s = input.trim().replace(/\/+$/, '')
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|\d+\.\d+\.\d+\.\d+)/.test(s)
    s = `${local ? 'http' : 'https'}://${s}`
  }
  return s
}

export function defaultServer() {
  const last = storage.get('hc-last-server')
  if (last) return last
  return location.protocol.startsWith('http') ? location.origin : ''
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`
  let details = ''
  try {
    const j = await res.json()
    const err = j?.error
    message = (typeof err === 'object' ? err?.message : err) ?? j?.message ?? message
    if (typeof message !== 'string') message = JSON.stringify(message)
    details = typeof j?.details === 'string' ? j.details : ''
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401 && message === 'Not authenticated') {
    setSession(null)
    message = 'Your session expired. Please sign in again.'
  }
  return new ApiError(res.status, message, details)
}

type RequestOptions = { method?: string; body?: unknown; rawBody?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal }

async function rawRequest(path: string, opts: RequestOptions = {}) {
  const s = current
  if (!s) throw new ApiError(401, 'Not signed in')
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}`, ...opts.headers }
  let body = opts.rawBody
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  try {
    const res = await fetch(`${s.server}/api/console${path}`, { method: opts.method ?? (body !== undefined ? 'POST' : 'GET'), headers, body, signal: opts.signal })
    if (!res.ok) throw await parseError(res)
    return res
  } catch (e) {
    if (e instanceof ApiError || (e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(path, opts)
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

/** Call the Hermes API server of a bot (profile) through the console proxy. */
export function hermes<T = unknown>(bot: string, path: string, opts: RequestOptions = {}) {
  return api<T>(`/hermes/${encodeURIComponent(bot)}/${path}`, opts)
}

export async function login(server: string, username: string, password: string) {
  const base = normalizeServer(server)
  if (!base) throw new ApiError(0, 'Enter the server URL')
  let res: Response
  try {
    res = await fetch(`${base}/api/console/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  } catch {
    throw new ApiError(0, `Cannot reach ${base}. Check the URL and that Hermes Console is running.`)
  }
  if (!res.ok) throw await parseError(res)
  const j = await res.json()
  storage.set('hc-last-server', base)
  setSession({ server: base, token: j.token, username: j.username, expiresAt: j.expires_at })
}

export type StreamEvent = { event: string; data: Record<string, any> }

export async function streamChat(bot: string, sessionId: string, body: unknown, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
  const res = await rawRequest(`/hermes/${encodeURIComponent(bot)}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
    body,
    headers: { Accept: 'text/event-stream' },
    signal,
  })
  if (!res.body) throw new ApiError(0, 'Streaming is not supported by this browser')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let match: RegExpExecArray | null
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
      }
      if (!dataLines.length) continue
      let data: Record<string, any>
      try {
        data = JSON.parse(dataLines.join('\n'))
      } catch {
        data = { text: dataLines.join('\n') }
      }
      // Event payloads may wrap fields in `data`; flatten for convenience.
      if (data && typeof data.data === 'object' && data.data !== null) data = { ...data, ...data.data }
      if (event === 'message' && typeof data.type === 'string') event = data.type
      onEvent({ event, data })
    }
  }
}

export function fileUrl(path: string, download = false) {
  const s = current
  if (!s) return '#'
  return `${s.server}/api/console/files/raw?path=${encodeURIComponent(path)}&token=${encodeURIComponent(s.token)}${download ? '&download=1' : ''}`
}

export function uploadFile(dir: string, file: File) {
  return api<{ entry: FileEntry }>(`/files/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`, {
    method: 'PUT',
    rawBody: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}
