import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useSql, rev, fmtDate } from '../lib'
import { Empty, Loading } from '../ui'
import { useNav } from '../nav'

/* Everything Lem wrote, shelved where it belongs: under the workstream, company or person
   it came out of, and only then by kind. Each document is a small page you can pick up. */

interface Doc {
  id: string; title: string; created_at: string; kind: string; status: string
  bucket: string; bucket_kind: 'workstream' | 'company' | 'person' | 'kind'; excerpt: string
  [k: string]: unknown
}

const KIND_FOLDER: Record<string, string> = {
  research: 'Research', brief: 'Briefs', meeting: 'Meeting notes', notes: 'Meeting notes', summary: 'Summaries',
}

const DOCS_SQL = `
  select d.id, d.title, d.created_at,
         coalesce(d.kind,'') as kind, coalesce(d.status,'') as status,
         left(coalesce(d.body,''), 220) as excerpt,
         coalesce(w.title, c.name, p.name, '') as bucket,
         case when w.title is not null then 'workstream'
              when c.name  is not null then 'company'
              when p.name  is not null then 'person'
              else 'kind' end as bucket_kind
  from deliverables d
  left join tasks t         on t.id = d.task_id
  left join loops l         on l.id = t.loop_id
  left join work_projects w on w.id = l.work_project_id
  left join companies c     on c.id = t.company_id
  left join people p        on p.id = t.person_id
  order by d.created_at desc
  limit 300`

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plain = (md: string) => md.replace(/^#+\s.*$/gm, '').replace(/[*_`>#|-]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim()

export function Docs() {
  const { version, open } = useNav()
  const rows = useSql<Doc>(rev(DOCS_SQL, version))
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()

  const shelves = useMemo(() => {
    const by = new Map<string, Doc[]>()
    for (const d of rows.items) {
      if (needle && !`${d.title} ${d.bucket} ${d.excerpt}`.toLowerCase().includes(needle)) continue
      const name = d.bucket_kind === 'kind'
        ? (KIND_FOLDER[d.kind] ?? (d.kind ? titleCase(d.kind) : 'Everything else'))
        : d.bucket
      const key = name || 'Everything else'
      const list = by.get(key)
      if (list) list.push(d)
      else by.set(key, [d])
    }
    return [...by.entries()].sort((a, b) => {
      const fallback = (e: [string, Doc[]]) => (e[1][0].bucket_kind === 'kind' ? 1 : 0)
      return fallback(a) - fallback(b) || b[1].length - a[1].length
    })
  }, [rows.items, needle])

  return (
    <div className="page">
      <header className="page-h">
        <h1 className="display sm">Docs</h1>
        <span className="muted">{rows.items.length} written</span>
      </header>
      {rows.items.length > 6 && (
        <div className="toolbar">
          <label className="search"><Search size={14} /><input placeholder="Search what Lem wrote…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
      )}
      {rows.isLoading ? <Loading rows={4} />
        : rows.items.length === 0 ? <Empty line="Lem hasn’t written anything yet." />
          : shelves.length === 0 ? <Empty line="Nothing matches that." />
            : shelves.map(([name, docs]) => (
              <section key={name} className="shelf-sec">
                <div className="sec-h">{name} <span className="muted">{docs.length}</span></div>
                <div className="pages">
                  {docs.map((d) => (
                    <button key={d.id} className="page-card" onClick={() => open({ type: 'doc', id: d.id })}>
                      <span className="pc-kind">{d.kind ? titleCase(d.kind) : 'Document'}</span>
                      <span className="pc-title">{d.title}</span>
                      <span className="pc-ex">{plain(d.excerpt)}</span>
                      <span className="pc-date">{fmtDate(d.created_at)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
    </div>
  )
}
