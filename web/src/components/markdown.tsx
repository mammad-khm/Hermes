import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Paperclip } from 'lucide-react'
import { fileUrl } from '@/lib/api'

const FILE_SCHEME = 'hcfile:'
const ABS_FILE = /^\/[^\s`*]+\.[A-Za-z0-9]{1,8}$/

/** Turn Hermes `MEDIA:/path` tags into links the console can serve. */
function preprocess(text: string) {
  return text.replace(/MEDIA:\s*(\S+)/g, (_, target: string) => {
    if (target.startsWith('data:image/')) return `![image](${target})`
    if (/^https?:\/\//.test(target)) return `[${target}](${target})`
    if (target.startsWith('/')) return `[${target.split('/').pop()}](${FILE_SCHEME}${encodeURIComponent(target)})`
    return target
  })
}

function urlTransform(url: string) {
  if (url.startsWith('data:image/') || url.startsWith(FILE_SCHEME)) return url
  return defaultUrlTransform(url)
}

function FileChip({ path }: { path: string }) {
  return (
    <a href={fileUrl(path)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 !no-underline hover:bg-accent">
      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-xs">{path.split('/').pop()}</span>
    </a>
  )
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          a: ({ href, children: label }) => {
            if (href?.startsWith(FILE_SCHEME)) return <FileChip path={decodeURIComponent(href.slice(FILE_SCHEME.length))} />
            if (href?.startsWith('/') && ABS_FILE.test(href)) return <FileChip path={href} />
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            )
          },
          img: ({ src, alt }) => {
            const url = typeof src === 'string' && src.startsWith('/') ? fileUrl(src) : src
            return <img src={typeof url === 'string' ? url : undefined} alt={alt ?? ''} loading="lazy" />
          },
          code: ({ className, children: code }) => {
            const text = String(code ?? '')
            if (!className && !text.includes('\n') && ABS_FILE.test(text.trim())) return <FileChip path={text.trim()} />
            return <code className={className}>{code}</code>
          },
        }}
      >
        {preprocess(children)}
      </ReactMarkdown>
    </div>
  )
}
