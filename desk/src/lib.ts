import { useDatastoreQuery } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'

export const client = lemmaClient

/** Joined SQL read against the pod datastore (RLS-scoped to the signed-in user). */
/* `rev()` threads a version through the SQL so writes refetch — but a new query text is a
   new query, which briefly came back empty and made every list (and the page) blink on
   each Done. Keep showing the last result for the same query until the fresh one lands. */
const lastResult = new Map<string, unknown[]>()

export function useSql<T extends Record<string, unknown> = Record<string, unknown>>(
  query: string | null,
  enabled = true,
) {
  const res = useDatastoreQuery<T>({ client, query, enabled: enabled && !!query })
  const base = query ? query.replace(/ -- v\d+$/, '') : ''
  if (base && !res.isLoading) lastResult.set(base, res.items as unknown[])
  if (base && res.isLoading && lastResult.has(base)) {
    return { ...res, items: lastResult.get(base) as T[], isLoading: false }
  }
  return res
}

export async function sql<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const res = await client.datastore.query(q)
  return ((res as { items?: T[] }).items ?? []) as T[]
}

export const records = {
  update: (table: string, id: string, data: Record<string, unknown>) => client.records.update(table, id, data),
  create: (table: string, data: Record<string, unknown>) => client.records.create(table, data),
  remove: (table: string, id: string) => client.records.delete(table, id),
}

/** Run a pod function and hand back its output.
 *  Anything that leaves the building goes through a function, never a record
 *  write — a table update cannot tell you Gmail refused the message. */
export async function runFn<T = Record<string, unknown>>(
  name: string, input: Record<string, unknown>,
): Promise<T> {
  const run = await client.functions.run(name, { input })
  const r = run as { output_data?: T; status?: string; error?: string }
  if (r.status && r.status !== 'COMPLETED') throw new Error(r.error || `${name} did not complete`)
  return (r.output_data ?? {}) as T
}

/** SQL string literal escape — single quotes are the only metacharacter that matters. */
export function lit(v: string | null | undefined): string {
  return `'${String(v ?? '').replace(/'/g, "''")}'`
}

/** Bust the query cache by threading a version through the SQL text. */
export function rev(q: string, v: number): string
export function rev(q: null, v: number): null
export function rev(q: string | null, v: number): string | null
export function rev(q: string | null, v: number): string | null {
  return q === null ? null : `${q} -- v${v}`
}

/* ---------------- shapes ---------------- */

export interface LoopRow {
  id: string
  side: 'you' | 'them' | 'neither'
  kind: string
  status: string
  obligation: string
  provenance?: string | null
  source?: string | null
  opened_at?: string | null
  due_at?: string | null
  urgency?: number | null
  urgency_reason?: string | null
  thread_ref?: string | null
  person_id?: string | null
  situation_id?: string | null
  person?: string | null
  person_email?: string | null
  avatar_url?: string | null
  company?: string | null
  has_draft?: number | null
  [k: string]: unknown
}

export interface SituationRow {
  id: string
  title: string
  summary?: string | null
  anchor?: string | null
  person_id?: string | null
  work_project_id?: string | null
  urgency?: number | null
  [k: string]: unknown
}

export interface PersonRow {
  id: string; name: string; email?: string | null
  role?: string | null; company?: string | null
  avatar_url?: string | null; context?: string | null
  relationship?: string | null; research?: string | null
  open_count?: number | null
  [k: string]: unknown
}

export interface WorkstreamRow {
  id: string; title: string; kind?: string | null; cadence?: string | null
  stands?: string | null; since_last?: string | null; raise_next?: string | null
  track_id?: string | null
  attendees?: unknown; last_met_at?: string | null
  [k: string]: unknown
}

export interface TimelineRow {
  id: string; type: string; title: string
  quote?: string | null; happened_at?: string | null; source?: string | null
  [k: string]: unknown
}

/* ---------------- time ---------------- */

export function daysSince(iso?: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

/** "4d", "2w", "3mo" — short enough to sit at the end of a sentence. */
export function ageLabel(iso?: string | null): string {
  const d = daysSince(iso)
  if (d === null) return ''
  if (d <= 0) return 'today'
  if (d === 1) return '1d'
  if (d < 14) return `${d}d`
  if (d < 60) return `${Math.floor(d / 7)}w`
  return `${Math.floor(d / 30)}mo`
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function fmtWhen(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `today, ${time}`
  const tomorrow = new Date(today.getTime() + 86400000)
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow, ${time}`
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function firstName(name?: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || 'there'
}

/** Who a commitment sits on, in the words the row uses. */
export function owedBy(l: LoopRow): string {
  const age = ageLabel(l.opened_at)
  const who = l.side === 'you' ? 'you' : (l.person || 'them')
  return age ? `${who} · ${age}` : who
}

/* ---------------- queries ---------------- */

export const LOOP_SELECT = `
  l.id, l.side, l.kind, l.status, l.obligation, l.provenance, l.source,
  l.opened_at, l.due_at, l.urgency, l.urgency_reason, l.thread_ref,
  l.person_id, l.work_project_id,
  coalesce(p.name,'') as person, p.email as person_email, p.avatar_url,
  coalesce(c.name,'') as company,
  (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft`

export const LOOP_FROM = `
  from loops l
  left join people p on p.id = l.person_id
  left join companies c on c.id = p.company_id`

export const OPEN_LOOPS = `select ${LOOP_SELECT} ${LOOP_FROM}
  where l.status='open'
  order by coalesce(l.urgency,2) asc, l.opened_at asc nulls last`

/* ---------------- day bounds (the person's own clock) ---------------- */

export function startOfToday(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}

/** Midnight tonight in the person's own timezone — "today" is theirs, not UTC's. */
export function endOfToday(): string {
  const d = new Date(); d.setHours(24, 0, 0, 0); return d.toISOString()
}

/** Calendar titles carry prefixes like "[Imp] " that mean nothing on screen. */
export function cleanTitle(t?: string | null): string {
  return String(t ?? '').replace(/^\s*\[[^\]]*\]\s*/, '').trim()
}

export const isGmailThread = (ref?: string | null) => !!ref && /^[0-9a-f]{10,24}$/.test(ref)

export const favicon = (domain?: string | null) =>
  domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null
