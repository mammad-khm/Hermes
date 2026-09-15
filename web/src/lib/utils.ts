import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

function toMillis(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null
  let ms = typeof input === 'number' ? input : Date.parse(String(input))
  if (Number.isNaN(ms)) return null
  if (ms < 1e12) ms *= 1000 // unix seconds
  return ms
}

export function timeAgo(input: unknown) {
  const ms = toMillis(input)
  if (ms === null) return ''
  const diff = (Date.now() - ms) / 1000
  if (diff < 0) return formatDateTime(ms)
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`
  return new Date(ms).toLocaleDateString()
}

export function formatDateTime(input: unknown) {
  const ms = toMillis(input)
  return ms === null ? '' : new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Render loosely-typed API values (strings, numbers, or {display} objects) as text. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    return String(v.display ?? v.expr ?? v.value ?? v.text ?? JSON.stringify(value))
  }
  return String(value)
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  }
}

export function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
