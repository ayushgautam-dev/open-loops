import { useEffect, useMemo, useState } from 'react'
import { useSql, rev } from './lib'
import { Avatar } from './ui'
import { useNav } from './nav'

/* One key to get anywhere. Jump to a person, a workstream or a doc — or just
   start typing and hand it to Lem. */

interface Hit {
  kind: 'person' | 'workstream' | 'doc' | 'page'
  id: string
  label: string
  sub?: string
  avatar?: string | null
}

export function CommandPalette({ onAsk }: { onAsk: (text: string) => void }) {
  const { openSheet, navigate, version } = useNav()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpen((v) => !v); setQ(''); setI(0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const people = useSql<{ id: string; name: string; company: string; avatar_url: string }>(rev(
    open ? `select p.id, p.name, coalesce(c.name,'') as company, p.avatar_url
            from people p left join companies c on c.id=p.company_id limit 300` : null, version))
  const ws = useSql<{ id: string; title: string; cadence: string }>(rev(
    open ? `select id, title, coalesce(cadence,'') as cadence from work_projects
            where archived=false or archived is null limit 100` : null, version))
  const docs = useSql<{ id: string; title: string }>(rev(
    open ? `select id, title from deliverables order by created_at desc limit 100` : null, version))

  const hits = useMemo<Hit[]>(() => {
    const all: Hit[] = [
      { kind: 'page', id: '/', label: 'Feed' },
      { kind: 'page', id: '/workstreams', label: 'Workstreams' },
      { kind: 'page', id: '/people', label: 'People' },
      { kind: 'page', id: '/docs', label: 'Docs' },
      { kind: 'page', id: '/autopilots', label: 'Autopilots' },
      ...people.items.map((p): Hit => ({ kind: 'person', id: p.id, label: p.name, sub: p.company, avatar: p.avatar_url })),
      ...ws.items.map((w): Hit => ({ kind: 'workstream', id: w.id, label: w.title, sub: w.cadence })),
      ...docs.items.map((d): Hit => ({ kind: 'doc', id: d.id, label: d.title })),
    ]
    const needle = q.trim().toLowerCase()
    if (!needle) return all.slice(0, 8)
    return all
      .filter((h) => `${h.label} ${h.sub ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [q, people.items, ws.items, docs.items])

  if (!open) return null

  function go(h: Hit) {
    setOpen(false)
    if (h.kind === 'page') navigate(h.id)
    else if (h.kind === 'person') openSheet({ type: 'person', id: h.id })
    else if (h.kind === 'doc') openSheet({ type: 'doc', id: h.id })
    else navigate('/workstreams')
  }

  return (
    <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="palette">
        <input
          autoFocus
          value={q}
          placeholder="Jump to anything, or ask Lem…"
          onChange={(e) => { setQ(e.target.value); setI(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(n + 1, hits.length)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(n - 1, 0)) }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (i < hits.length) go(hits[i])
              else if (q.trim()) { setOpen(false); onAsk(q.trim()) }
            }
          }}
        />
        <div className="pal-list">
          {hits.map((h, n) => (
            <button key={`${h.kind}:${h.id}`} className={`pal-row${n === i ? ' on' : ''}`}
              onMouseEnter={() => setI(n)} onClick={() => go(h)}>
              {h.kind === 'person' ? <Avatar name={h.label} src={h.avatar} /> : <span className="pal-k">{h.kind === 'page' ? '→' : h.kind === 'doc' ? '¶' : '◆'}</span>}
              <span className="pal-l">{h.label}</span>
              {h.sub && <span className="pal-s">{h.sub}</span>}
            </button>
          ))}
          {q.trim() && (
            <button className={`pal-row${i === hits.length ? ' on' : ''}`}
              onMouseEnter={() => setI(hits.length)}
              onClick={() => { setOpen(false); onAsk(q.trim()) }}>
              <span className="pal-k">✦</span>
              <span className="pal-l">Ask Lem “{q.trim()}”</span>
            </button>
          )}
        </div>
      </div>
    </>
  )
}
