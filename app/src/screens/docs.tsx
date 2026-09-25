import { useMemo, useState } from 'react'
import { Folder, FolderOpen, FileText } from 'lucide-react'
import { useSql, rev, fmtDate } from '../lib'
import { Empty, Loading } from '../ui'
import { useNav } from '../nav'

/* Everything Lem has written, filed where it belongs.
   A flat list was fine at five documents and useless at fifty. A document earns
   its folder from the work it came out of: the workstream it belongs to, or the
   company or person it is about. Only what genuinely has no home falls back to
   being grouped by what kind of thing it is. */

interface Doc {
  id: string
  title: string
  created_at: string
  kind: string
  status: string
  bucket: string
  bucket_kind: 'workstream' | 'company' | 'person' | 'kind'
  [k: string]: unknown
}

const KIND_FOLDER: Record<string, string> = {
  research: 'Research',
  brief: 'Briefs',
  meeting: 'Meeting notes',
  notes: 'Meeting notes',
  summary: 'Summaries',
}

const DOCS_SQL = `
  select d.id, d.title, d.created_at,
         coalesce(d.kind,'') as kind, coalesce(d.status,'') as status,
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

export function Docs() {
  const { version, openSheet } = useNav()
  const rows = useSql<Doc>(rev(DOCS_SQL, version))
  const [shut, setShut] = useState<Record<string, boolean>>({})

  const folders = useMemo(() => {
    const by = new Map<string, Doc[]>()
    for (const d of rows.items) {
      const name = d.bucket_kind === 'kind'
        ? (KIND_FOLDER[d.kind] ?? (d.kind ? titleCase(d.kind) : 'Everything else'))
        : d.bucket
      const key = name || 'Everything else'
      const list = by.get(key)
      if (list) list.push(d)
      else by.set(key, [d])
    }
    // Workstreams and named records first — the folders somebody went looking for —
    // then the kind buckets, which are a fallback rather than a place.
    return [...by.entries()].sort((a, b) => {
      const fallback = (e: [string, Doc[]]) => (e[1][0].bucket_kind === 'kind' ? 1 : 0)
      return fallback(a) - fallback(b) || b[1].length - a[1].length
    })
  }, [rows.items])

  if (rows.isLoading) return <div className="page"><h1>Docs</h1><Loading /></div>

  return (
    <div className="page">
      <h1>Docs</h1>
      <div className="sub">
        {rows.items.length} written{folders.length > 1 ? ` · ${folders.length} folders` : ''}
      </div>

      {rows.items.length === 0
        ? <Empty line="Lem has not written anything yet." />
        : folders.map(([name, docs]) => {
          const open = !shut[name]
          return (
            <section key={name} className="fold">
              <button className="fold-top"
                aria-expanded={open}
                onClick={() => setShut((s) => ({ ...s, [name]: open }))}>
                {open
                  ? <FolderOpen size={15} strokeWidth={1.9} />
                  : <Folder size={15} strokeWidth={1.9} />}
                <span className="fold-name">{name}</span>
                <span className="fold-n">{docs.length}</span>
              </button>
              {open && (
                <div className="fold-body">
                  {docs.map((d) => (
                    <button key={d.id} className="row doc-row"
                      onClick={() => openSheet({ type: 'doc', id: d.id })}>
                      <FileText size={14} strokeWidth={1.8} className="doc-ic" />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="nm">{d.title}</span>
                        {d.kind && <span className="ds"> {titleCase(d.kind)}</span>}
                      </span>
                      <span className="rt">{fmtDate(d.created_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )
        })}
    </div>
  )
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
