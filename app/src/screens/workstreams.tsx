import { useState } from 'react'
import { useSql, rev, lit, fmtWhen, type LoopRow, type WorkstreamRow } from '../lib'
import { Avatars, Empty, Loading, Markdown } from '../ui'
import { Correctable } from '../correct'
import { useNav } from '../nav'
import { ItemList } from '../items'

/* The standing list of what you are running. Never empties.
   One page, one block each — no tabs, and none of the machinery on screen. */

function Board({ cards }: { cards: { stage: string; name: string; note?: string | null }[] }) {
  const stages = Array.from(new Set(cards.map((c) => c.stage)))
  return (
    <div className="board">
      <div className="cols">
        {stages.map((st) => {
          const inStage = cards.filter((c) => c.stage === st)
          return (
            <div key={st}>
              <div className="col-h"><span>{st}</span><span>{inStage.length}</span></div>
              {inStage.map((c, i) => (
                <div key={i} className="card">
                  <div><b>{c.name}</b>{c.note && <small>{c.note}</small>}</div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** work_projects stores the series date, which is often the *next* occurrence.
 *  Calling that "last met" was simply wrong on screen. */
function whenLabel(w: WorkstreamRow): string {
  const t = w.last_met_at ? Date.parse(w.last_met_at) : NaN
  if (!Number.isNaN(t)) {
    return t > Date.now() ? `Next ${fmtWhen(w.last_met_at)}` : (w.cadence || `Last met ${fmtWhen(w.last_met_at)}`)
  }
  return w.cadence || ''
}

function Stream({ w, loops, onChange }: {
  w: WorkstreamRow; loops: LoopRow[]; onChange: () => void
}) {
  const { version, openSheet } = useNav()
  const [showBoard, setShowBoard] = useState(false)

  const cards = useSql<{ stage: string; name: string; note: string }>(rev(
    w.track_id
      ? `select coalesce(s.name,'—') as stage, coalesce(p.name, c.name, '—') as name,
                coalesce(b.last_move_reason,'') as note
         from board_cards b
         left join stages s on s.id = b.stage_id
         left join people p on p.id = b.person_id
         left join companies c on c.id = b.company_id
         where b.track_id = ${lit(String(w.track_id))}
         order by s.position nulls last`
      : null, version))

  const fromLoops = loops.filter((l) => l.person)
    .map((l) => ({ id: l.person_id as string, name: l.person as string, avatar_url: l.avatar_url }))
  const fromAttendees = Array.isArray(w.attendees)
    ? (w.attendees as string[]).map((a) => ({ id: null as string | null, name: String(a).split('@')[0], avatar_url: null }))
    : []
  const people = Array.from(
    new Map((fromLoops.length ? fromLoops : fromAttendees).map((p) => [p.name, p])).values(),
  )

  return (
    <div className="block">
      <div className="block-top">
        <button className="block-name" onClick={() => openSheet({ type: 'workstream', id: w.id })}>{w.title}</button>
        <Avatars people={people} onPick={(id) => openSheet({ type: 'person', id })} />
        <span className="when">{whenLabel(w)}</span>
      </div>
      {w.stands && (
        <div>
          <Correctable text={w.stands} kind="workstream" subjectId={w.id}
            about={`where "${w.title}" stands`} />
        </div>
      )}
      {String(w.raise_next ?? '').trim() && String(w.raise_next).trim() !== 'Nothing worth raising' && (
        <div className="raise">
          <div className="cap" style={{ marginBottom: 7 }}>Raise next time</div>
          <Markdown text={String(w.raise_next)} />
        </div>
      )}
      {loops.length > 0
        ? <ItemList loops={loops} onChange={onChange} limit={3} />
        : <div className="empty" style={{ padding: '2px 0 0', fontSize: 13.5 }}>Nothing outstanding.</div>}

      {w.track_id && w.kind !== 'account' ? (
        <>
          <button className="more" onClick={() => setShowBoard((v) => !v)}>
            {showBoard ? '▾' : '▸'} Pipeline
          </button>
          {showBoard && cards.items.length > 0 && <Board cards={cards.items} />}
        </>
      ) : null}
    </div>
  )
}

/* Workstreams are the things you run that have a rhythm or a finish line:
   recurring meetings, and projects (hiring rounds, launches, deliveries).
   Customers and deals are not here — they are companies, with their pipeline under
   Companies on the home page — so nothing appears in two places. */

export function Workstreams() {
  const { version, bump } = useNav()
  const [tab, setTab] = useState<'projects' | 'meetings'>('projects')

  const ws = useSql<WorkstreamRow>(rev(
    `select id, title, coalesce(kind,'') as kind, cadence, stands, since_last, last_met_at, track_id, attendees, raise_next
     from work_projects where (archived=false or archived is null) and coalesce(kind,'') <> 'account'
     order by last_met_at desc nulls last`, version))

  const loops = useSql<LoopRow>(rev(
    `select l.id, l.side, l.kind, l.obligation, l.provenance, l.source, l.opened_at,
            l.urgency, l.urgency_reason, l.thread_ref, l.person_id, l.work_project_id,
            coalesce(p.name,'') as person, p.avatar_url,
            (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft
     from loops l left join people p on p.id=l.person_id
     where l.status='open'
     order by coalesce(l.urgency,2) asc`, version))

  if (ws.isLoading) return <div className="page"><Loading /></div>

  // anything written before kinds existed reads as a meeting unless it has a board
  const kindOf = (w: WorkstreamRow) => String(w.kind || (w.track_id ? 'hiring' : 'meeting'))
  const meetings = ws.items.filter((w) => kindOf(w) === 'meeting')
  const projects = ws.items.filter((w) => kindOf(w) !== 'meeting')
  const list = tab === 'meetings' ? meetings : projects

  return (
    <div className="page">
      <h1>Workstreams</h1>
      <div className="seg" style={{ marginTop: 12 }}>
        <button className={tab === 'projects' ? 'on' : ''} onClick={() => setTab('projects')}>
          Projects <span className="seg-n">{projects.length}</span>
        </button>
        <button className={tab === 'meetings' ? 'on' : ''} onClick={() => setTab('meetings')}>
          Recurring meetings <span className="seg-n">{meetings.length}</span>
        </button>
      </div>
      {list.length === 0
        ? <Empty line={tab === 'meetings' ? 'No recurring meetings yet.' : 'No projects running.'} />
        : list.map((w) => (
          <Stream key={w.id} w={w} onChange={bump}
            loops={loops.items.filter((l) => l.work_project_id === w.id)} />
        ))}
    </div>
  )
}
