import { useState } from 'react'
import { ChevronRight, Repeat, FolderKanban, ListChecks, Check } from 'lucide-react'
import { worthRaising } from '../focus'
import { useSql, rev, lit, fmtWhen, ageLabel, type LoopRow, type WorkstreamRow } from '../lib'
import { Faces, Empty, Loading, Markdown, Orb } from '../ui'
import { Correctable } from '../correct'
import { useNav } from '../nav'
import { ItemList } from '../items'
import { Board, boardSql, type BoardRow } from './board'
import { useOpenTask, type TaskRow } from '../lem'
import { useTeammate } from '../teammate'

/* The standing list of what you run — projects with a finish line, meetings with a rhythm.
   Each is one card: where it stands, what to raise next time, what's open, and its board
   when it has one. Accounts live under Companies, so nothing appears twice. */

/** work_projects stores the series date, which is often the *next* occurrence. */
function whenLabel(w: WorkstreamRow): string {
  const t = w.last_met_at ? Date.parse(w.last_met_at) : NaN
  if (!Number.isNaN(t)) {
    return t > Date.now() ? `Next ${fmtWhen(w.last_met_at)}` : (w.cadence || `Last met ${fmtWhen(w.last_met_at)}`)
  }
  return w.cadence || ''
}

function Stream({ w, loops, onChange }: { w: WorkstreamRow; loops: LoopRow[]; onChange: () => void }) {
  const { version, open } = useNav()
  const [showBoard, setShowBoard] = useState(false)
  const cards = useSql<BoardRow>(rev(
    w.track_id && showBoard ? boardSql(`b.track_id = ${lit(String(w.track_id))}`) : null, version))

  const fromLoops = loops.filter((l) => l.person)
    .map((l) => ({ id: l.person_id as string, name: l.person as string, avatar_url: l.avatar_url }))
  const fromAttendees = Array.isArray(w.attendees)
    ? (w.attendees as string[]).map((a) => ({ id: null as string | null, name: String(a).split('@')[0], avatar_url: null }))
    : []
  const people = Array.from(new Map((fromLoops.length ? fromLoops : fromAttendees).map((p) => [p.name, p])).values())
  const raise = String(w.raise_next ?? '').trim()
  const hasRaise = worthRaising(raise)

  return (
    <article className="card ws-card">
      <header className="card-h">
        <button className="card-title" onClick={() => open({ type: 'workstream', id: w.id })} title="Open">
          <h3>{w.title}</h3><ChevronRight size={16} />
        </button>
        <span className="grow" />
        <Faces people={people} onPick={(id) => open({ type: 'person', id })} />
        {whenLabel(w) && <span className="card-meta">{whenLabel(w)}</span>}
      </header>
      {w.stands && <Correctable text={w.stands} kind="workstream" subjectId={w.id} about={`where "${w.title}" stands`} lines={3} />}
      {hasRaise && (
        <div className="agenda">
          <div className="eyebrow">Raise next time</div>
          <Markdown text={raise} />
        </div>
      )}
      {loops.length > 0
        ? <ItemList loops={loops} onChange={onChange} limit={3} />
        : <p className="muted quiet-line">Nothing outstanding.</p>}
      {w.track_id && w.kind !== 'account' && (
        <>
          <button className="disclose" onClick={() => setShowBoard((v) => !v)}>
            <ChevronRight size={14} style={{ transform: showBoard ? 'rotate(90deg)' : 'none' }} /> Pipeline
          </button>
          {showBoard && (cards.isLoading ? <Loading rows={2} /> : cards.items.length > 0
            ? <Board rows={cards.items} stagesWhere={`track_id = ${lit(String(w.track_id))}`} />
            : <p className="muted quiet-line">Nobody on the board yet.</p>)}
        </>
      )}
    </article>
  )
}

/* Everything you asked for with "Do": what is running, what is ready to look at, and what
   is finished. Finished work stays listed, so a task never just disappears. */
const TASK_GROUPS: { status: string; label: string }[] = [
  { status: 'working', label: 'Running' }, { status: 'drafted', label: 'Ready to look at' }, { status: 'done', label: 'Done' },
]

function Asked({ tasks }: { tasks: TaskRow[] }) {
  const openTask = useOpenTask()
  if (!tasks.length) return <Empty line="Nothing asked yet. Switch the bar below to Do." />
  return (
    <div className="stories">
      {TASK_GROUPS.map((g) => {
        const own = tasks.filter((t) => t.status === g.status)
        if (!own.length) return null
        return (
          <section key={g.status} className="group-sec">
            <div className="sec-h">{g.label}</div>
            <div className="card asked">
              {own.map((t) => (
                <button key={t.id} className={`asked-r is-${t.status}`} onClick={() => void openTask(t)}>
                  {t.status === 'working' ? <Orb live size={12} /> : <Check size={14} strokeWidth={2.6} />}
                  <span className="asked-t">{t.title}</span>
                  <span className="muted">{ageLabel(t.updated_at)}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function Workstreams() {
  const { version, bump } = useNav()
  const teammate = useTeammate()
  const [tab, setTab] = useState<'projects' | 'meetings' | 'asked'>('projects')
  const tasks = useSql<TaskRow>(rev(
    `select id, title, status, thread_ref, updated_at from tasks
     where source='manual' and status in ('working','drafted','done')
     order by updated_at desc limit 60`, version))

  const ws = useSql<WorkstreamRow>(rev(
    `select id, title, coalesce(kind,'') as kind, cadence, stands, since_last, last_met_at, track_id, attendees, raise_next
     from work_projects where (archived=false or archived is null) and coalesce(kind,'') <> 'account'
     order by last_met_at desc nulls last`, version))

  const loops = useSql<LoopRow>(rev(
    `select l.id, l.side, l.kind, l.obligation, l.provenance, l.source, l.opened_at, l.due_at,
            l.urgency, l.urgency_reason, l.thread_ref, l.person_id, l.work_project_id,
            coalesce(p.name,'') as person, p.avatar_url,
            (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft
     from loops l left join people p on p.id=l.person_id
     where l.status='open'
     order by coalesce(l.urgency,2) asc`, version))

  // anything written before kinds existed reads as a meeting unless it has a board
  const kindOf = (w: WorkstreamRow) => String(w.kind || (w.track_id ? 'hiring' : 'meeting'))
  const meetings = ws.items.filter((w) => kindOf(w) === 'meeting')
  const projects = ws.items.filter((w) => kindOf(w) !== 'meeting')
  const list = tab === 'meetings' ? meetings : projects

  return (
    <div className="page">
      <header className="page-h">
        <h1 className="display sm">Workstreams</h1>
        <div className="seg">
          <button className={tab === 'projects' ? 'on' : ''} onClick={() => setTab('projects')}>
            <FolderKanban size={14} /> Projects <span>{projects.length}</span>
          </button>
          <button className={tab === 'meetings' ? 'on' : ''} onClick={() => setTab('meetings')}>
            <Repeat size={14} /> Recurring meetings <span>{meetings.length}</span>
          </button>
          <button className={tab === 'asked' ? 'on' : ''} onClick={() => setTab('asked')}>
            <ListChecks size={14} /> Asked of {teammate} <span>{tasks.items.length}</span>
          </button>
        </div>
      </header>
      {tab === 'asked' ? (tasks.isLoading ? <Loading rows={3} /> : <Asked tasks={tasks.items} />)
        : ws.isLoading ? <Loading rows={4} />
        : list.length === 0
          ? <Empty line={tab === 'meetings' ? 'No recurring meetings yet.' : 'No projects running.'} />
          : <div className="stories">{list.map((w) => (
              <Stream key={w.id} w={w} onChange={bump} loops={loops.items.filter((l) => l.work_project_id === w.id)} />
            ))}</div>}
    </div>
  )
}
