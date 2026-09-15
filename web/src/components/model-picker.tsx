import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { errorMessage, hermes } from '@/lib/api'

export type ProviderRow = { slug: string; name?: string; models?: unknown[]; authenticated?: boolean; is_current?: boolean; total_models?: number }

export const modelId = (m: unknown) => (typeof m === 'string' ? m : String((m as { id?: string; name?: string })?.id ?? (m as { name?: string })?.name ?? ''))

export function useModelOptions(bot: string) {
  const [rows, setRows] = React.useState<ProviderRow[]>([])
  const [current, setCurrent] = React.useState<{ model?: string; provider?: string }>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(
    async (refresh = false) => {
      setLoading(true)
      try {
        const r = await hermes<{ providers?: ProviderRow[]; model?: string; provider?: string }>(bot, `api/model/options${refresh ? '?refresh=1' : ''}`)
        const sorted = [...(r.providers ?? [])].sort((a, b) => Number(!!b.authenticated) - Number(!!a.authenticated))
        setRows(sorted)
        setCurrent({ model: r.model, provider: r.provider })
        setError(null)
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [bot],
  )

  React.useEffect(() => {
    load()
  }, [load])

  return { rows, current, loading, error, reload: load }
}

export function ModelPicker({ bot, provider, model, onChange }: { bot: string; provider: string; model: string; onChange: (v: { provider: string; model: string }) => void }) {
  const { rows, loading, error, reload } = useModelOptions(bot)
  const listId = React.useId()
  const row = rows.find((r) => r.slug === provider)
  const models = (row?.models ?? []).map(modelId).filter(Boolean)
  const suggestions = models.filter((m) => !model || m.toLowerCase().includes(model.toLowerCase())).slice(0, 8)

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Provider</Label>
          {rows.length ? (
            <Select value={provider || undefined} onValueChange={(v) => onChange({ provider: v, model: '' })}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                {provider && !row && <SelectItem value={provider}>{provider}</SelectItem>}
                {rows.map((r) => (
                  <SelectItem key={r.slug} value={r.slug}>
                    {r.name || r.slug}
                    {r.authenticated ? '  ✓' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={provider} onChange={(e) => onChange({ provider: e.target.value, model })} placeholder={loading ? 'Loading providers…' : 'e.g. openrouter'} />
          )}
        </div>
        <div className="grid gap-2">
          <Label>Model</Label>
          <Input list={listId} value={model} onChange={(e) => onChange({ provider, model: e.target.value })} placeholder={models[0] ?? 'e.g. anthropic/claude-sonnet-4'} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <datalist id={listId}>
            {models.slice(0, 400).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>
      {suggestions.length > 0 && suggestions[0] !== model && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((m) => (
            <button key={m} type="button" onClick={() => onChange({ provider, model: m })}>
              <Badge variant="outline" className="cursor-pointer font-mono hover:bg-accent">
                {m}
              </Badge>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{error ? `Model catalog unavailable (${error}). You can still type a provider and model.` : '✓ means credentials for that provider are configured.'}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => reload(true)} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh catalog
        </Button>
      </div>
    </div>
  )
}
