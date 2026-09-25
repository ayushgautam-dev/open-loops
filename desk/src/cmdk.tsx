import { useEffect, useMemo, useState } from 'react'
import { Sun, Layers, Users, FileText, Zap, Building2, CornerDownLeft } from 'lucide-react'
import { useSql, rev } from './lib'
import { Avatar, Logo, Orb } from './ui'
import { useNav } from './nav'

/* ⌘K — jump to a person, company, workstream or document, or hand the words to Lem. */

interface Hit {
  kind: 'person' | 'company' | 'workstream' | 'doc' | 'page'
  id: string; label: string; sub?: string; avatar?: string | null; domain?: string | null
}

const PAGES: { id: string; label: string; icon: typeof Sun }[] = [
  { id: '/', label: 'Today', icon: Sun },
  { id: '/workstreams', label: 'Workstreams', icon: Layers },
  { id: '/people', label: 'People', icon: Users },
  { id: '/docs', label: 'Docs', icon: FileText },
  { id: '/autopilots', label: 'Autopilots', icon: Zap },
]

export function CommandPalette({ onAsk }: { onAsk: (text: string) => void }) {
  const { open: openFocus, navigate, version } = useNav()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); setQ(''); setI(0) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const people = useSql<{ id: string; name: string; company: string; avatar_url: string }>(rev(
    open ? `select p.id, p.name, coalesce(c.name,'') as company, p.avatar_url
            from people p left join companies c on c.id=p.company_id limit 300` : null, version))
  const companies = useSql<{ id: string; name: string; domain: string }>(rev(
    open ? `select id, name, coalesce(domain,'') as domain from companies limit 200` : null, version))
  const ws = useSql<{ id: string; title: string; cadence: string }>(rev(
    open ? `select id, title, coalesce(cadence,'') as cadence from work_projects
            where archived=false or archived is null limit 100` : null, version))
  const docs = useSql<{ id: string; title: string }>(rev(
    open ? `select id, title from deliverables order by created_at desc limit 100` : null, version))

  const hits = useMemo<Hit[]>(() => {
    const all: Hit[] = [
      ...PAGES.map((p): Hit => ({ kind: 'page', id: p.id, label: p.label })),
      ...people.items.map((p): Hit => ({ kind: 'person', id: p.id, label: p.name, sub: p.company, avatar: p.avatar_url })),
      ...companies.items.map((c): Hit => ({ kind: 'company', id: c.id, label: c.name, sub: c.domain, domain: c.domain })),
      ...ws.items.map((w): Hit => ({ kind: 'workstream', id: w.id, label: w.title, sub: w.cadence || 'Workstream' })),
      ...docs.items.map((d): Hit => ({ kind: 'doc', id: d.id, label: d.title, sub: 'Document' })),
    ]
    const needle = q.trim().toLowerCase()
    if (!needle) return all.slice(0, 5)
    return all.filter((h) => `${h.label} ${h.sub ?? ''}`.toLowerCase().includes(needle)).slice(0, 8)
  }, [q, people.items, companies.items, ws.items, docs.items])

  if (!open) return null

  function go(h: Hit) {
    setOpen(false)
    if (h.kind === 'page') navigate(h.id)
    else if (h.kind === 'person') openFocus({ type: 'person', id: h.id })
    else if (h.kind === 'company') openFocus({ type: 'company', id: h.id })
    else if (h.kind === 'doc') openFocus({ type: 'doc', id: h.id })
    else openFocus({ type: 'workstream', id: h.id })
  }
  const askRow = hits.length

  return (
    <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="palette" role="dialog" aria-label="Jump to">
        <input
          autoFocus value={q} placeholder="Jump to anyone or anything — or ask Lem…"
          onChange={(e) => { setQ(e.target.value); setI(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(n + 1, q.trim() ? askRow : hits.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(n - 1, 0)) }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (i < hits.length) go(hits[i])
              else if (q.trim()) { setOpen(false); onAsk(q.trim()) }
            }
          }}
        />
        <div className="pal-list">
          {hits.map((h, n) => {
            const P = PAGES.find((p) => p.id === h.id)?.icon
            return (
              <button key={`${h.kind}:${h.id}`} className={`pal-row${n === i ? ' on' : ''}`} onMouseEnter={() => setI(n)} onClick={() => go(h)}>
                {h.kind === 'person' ? <Avatar name={h.label} src={h.avatar} size="xs" />
                  : h.kind === 'company' ? <Logo name={h.label} domain={h.domain} />
                    : <span className="pal-k">{h.kind === 'page' && P ? <P size={14} /> : h.kind === 'doc' ? <FileText size={14} /> : h.kind === 'workstream' ? <Layers size={14} /> : <Building2 size={14} />}</span>}
                <span className="pal-l">{h.label}</span>
                {h.sub && <span className="pal-s">{h.sub}</span>}
                {n === i && <CornerDownLeft size={13} className="pal-enter" />}
              </button>
            )
          })}
          {q.trim() && (
            <button className={`pal-row ask${i === askRow ? ' on' : ''}`} onMouseEnter={() => setI(askRow)} onClick={() => { setOpen(false); onAsk(q.trim()) }}>
              <Orb size={16} />
              <span className="pal-l">Ask Lem “{q.trim()}”</span>
            </button>
          )}
        </div>
      </div>
    </>
  )
}
