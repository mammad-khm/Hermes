import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn, copyText } from '@/lib/utils'

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto w-full max-w-6xl px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-8 md:pt-8', className)}>{children}</div>
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label="Copy"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn('group relative rounded-lg border bg-muted/40', className)}>
      <pre className="overflow-x-auto p-3 pr-11 font-mono text-xs leading-relaxed whitespace-pre">{code}</pre>
      <CopyButton text={code} className="absolute top-1.5 right-1.5 bg-background/80 backdrop-blur" />
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
