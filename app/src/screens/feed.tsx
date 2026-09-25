import { useState } from 'react'
import { ArrowUp, FileText, CalendarPlus, Send } from 'lucide-react'
import {
  useSql, records, rev, lit, greeting, fmtTime,
  type LoopRow, type SituationRow,
} from '../lib'
import { Avatars, Empty, Loading } from '../ui'
import { useNav } from '../nav'
import { ItemList } from '../items'
import { useAskLem } from '../asklem'
import { Correctable } from '../correct'
import { Lens } from './lenses'
import { WeatherMark } from '../weather'

/* The Feed answers "what is new and what needs me?".
   A workstream only appears here when it actually needs something. */

/** Midnight tonight in the person's own timezone — "today" is theirs, not UTC's. */
function endOfToday(): string {
  const d = new Date(); d.setHours(24, 0, 0, 0); return d.toISOString()
}

function Greeting({ name }: { name: string }) {
  const { version } = useNav()
  // Only the real calendar, and only what is still to come today. A meeting derived
  // from an email is not on the calendar, and something three days out is not "next up".
  const next = useSql<{ title: string; starts_at: string }>(rev(
    `select subject as title, occurred_at as starts_at
     from interactions
     where source='calendar' and kind='meeting'
       and occurred_at >= now()
       and occurred_at < ${lit(endOfToday())}
     order by occurred_at asc limit 1`, version))

  const m = next.items[0]
  const label = (m?.title ?? '')
    .replace(/^\s*\[[^\]]*\]\s*/, '')          // calendar prefixes like "[Imp] "
    .trim()

  return (
    <div className="hello">
      <WeatherMark />
      <span>
        {greeting()}, {name}.{' '}
        {m
          ? <>Next up, <b>{label}</b> at {fmtTime(m.starts_at)}.</>
          : <>Nothing else on your calendar today.</>}
      </span>
    </div>
  )
}

function Ask({ onSend }: { onSend: (text: string, mode: 'ask' | 'do') => void }) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'ask' | 'do'>('ask')
  const fire = () => { if (text.trim()) { onSend(text.trim(), mode); setText('') } }
  return (
    <div className="ask">
      <textarea
        rows={1}
        value={text}
        placeholder={mode === 'ask' ? 'Ask Lem anything…' : 'Tell Lem what to do…'}
        onChange={(e) => {
          setText(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${Math.min(e.target.scrollHeight, 190)}px`
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire() } }}
      />
      <div className="ask-bar">
        <div className="mode">
          <button className={mode === 'ask' ? 'on' : ''} onClick={() => setMode('ask')}>Ask</button>
          <button className={mode === 'do' ? 'on' : ''} onClick={() => setMode('do')}>Do</button>
        </div>
        <button className="send-btn" disabled={!text.trim()} onClick={fire} title="Send">
          <ArrowUp size={14} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  )
}

function Strip() {
  const { version } = useNav()
  const q = useSql<{ id: string; title: string; status: string }>(rev(
    `select id, title, status from tasks where status in ('working','queued')
     order by created_at desc limit 4`, version))
  if (!q.items.length) return null
  return (
    <div className="strip">
      {q.items.map((t) => (
        <div key={t.id} className="task-chip">
          <span className="pulse" />
          <span className="t">{t.title}</span>
          <span className="step">{t.status === 'working' ? 'Working…' : 'Queued'}</span>
        </div>
      ))}
    </div>
  )
}

/** Everything Lem has ready for a yes, as one row of chips — opened in the pane beside
 *  the Feed, never inline. Only real open commitments; nothing if there is nothing. */
function Prepared() {
  const { version, openSheet } = useNav()
  const [all, setAll] = useState(false)
  const q = useSql<{ loop_id: string; kind: string; person: string; obligation: string; side: string; docs: number }>(rev(
    `select distinct on (l.id) l.id as loop_id, coalesce(d.kind,'email') as kind,
            coalesce(p.name,'') as person, l.obligation, l.side,
            (select count(*) from deliverables x where x.loop_id=l.id and x.status <> 'discarded') as docs
     from drafts d join loops l on l.id=d.loop_id and l.status='open'
     left join people p on p.id=l.person_id
     where d.status='pending'
     order by l.id, d.created_at desc`, version))
  if (!q.items.length) return null
  const label = (r: typeof q.items[number]) => {
    const who = r.person.split(' ')[0] || 'them'
    if (Number(r.docs) > 0) return `Document + email to ${who}`
    if (r.kind === 'meeting') return `Times for ${who}`
    return r.side === 'them' ? `Nudge to ${who}` : `Email to ${who}`
  }
  const rows = all ? q.items : q.items.slice(0, 4)
  return (
    <div className="prep">
      <div className="prep-h"><span className="lem-dot sm" aria-hidden><i /></span>Ready for you <span className="n">{q.items.length}</span></div>
      {rows.map((r) => (
        <button key={r.loop_id} className="prep-r" onClick={() => openSheet({ type: 'loop', id: r.loop_id })}>
          {Number(r.docs) > 0 ? <FileText size={14} /> : r.kind === 'meeting' ? <CalendarPlus size={14} /> : <Send size={14} />}
          <span className="k">{label(r)}</span>
          <span className="t">{r.obligation}</span>
        </button>
      ))}
      {q.items.length > 4 && (
        <button className="prep-more" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `${q.items.length - 4} more`}</button>
      )}
    </div>
  )
}

function Suggestions() {
  const { version, bump } = useNav()
  const askLem = useAskLem()
  const q = useSql<{ id: string; proposal: string; reason: string }>(rev(
    `select id, proposal, reason from suggestions where status='open'
     order by created_at desc limit 3`, version))
  if (!q.items.length) return null

  async function decide(id: string, status: 'added' | 'dismissed', proposal?: string) {
    await records.update('suggestions', id, { status })
    bump()
    if (status === 'added' && proposal) {
      askLem(`Set this up for me as an autopilot: ${proposal}`)
    }
  }

  return (
    <div className="block">
      <div className="cap">Suggested for you</div>
      {q.items.map((s) => (
        <div key={s.id} className="sugg">
          <div className="sugg-p">{s.proposal}</div>
          <div className="sugg-r">{s.reason}</div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => void decide(s.id, 'added', s.proposal)}>Add it</button>
            <button className="btn quiet" onClick={() => void decide(s.id, 'dismissed')}>No thanks</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Block({ s, loops, onChange }: {
  s: SituationRow; loops: LoopRow[]; onChange: () => void
}) {
  const { openSheet } = useNav()
  /* A block opens whole in the pane: a company-backed topic opens the company (the same
     view as the Companies tab), a workstream opens the workstream, a person-only topic
     opens the person. */
  const openBlock = (x: SituationRow) => {
    if (x.open_company) openSheet({ type: 'company', id: String(x.open_company) })
    else if (x.work_project_id) openSheet({ type: 'workstream', id: x.work_project_id })
    else if (x.person_id) openSheet({ type: 'person', id: x.person_id })
    else if (loops[0]?.person_id) openSheet({ type: 'person', id: loops[0].person_id })
  }
  const people = Array.from(
    new Map(loops.filter((l) => l.person).map((l) => [l.person, { id: l.person_id, name: l.person, avatar_url: l.avatar_url }])).values(),
  )
  return (
    <div className="block">
      <div className="block-top">
        {s.domain ? <img className="block-logo" src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=64`} alt="" /> : null}
        <button className="block-name" onClick={() => openBlock(s)}>{s.title}</button>
        <Avatars people={people} onPick={(id) => openSheet({ type: 'person', id })} />
        <span className="when">
          {loops.length} open
        </span>
      </div>
      {s.summary && (
        <div>
          <Correctable text={s.summary} kind="situation" subjectId={s.id}
            about={`the summary for "${s.title}"`} />
        </div>
      )}
      <ItemList loops={loops} onChange={onChange} limit={3} />
    </div>
  )
}

export function Feed({ userName }: { userName: string }) {
  const { version, bump } = useNav()
  const askLem = useAskLem()
  const [view, setView] = useState<'feed' | 'people' | 'companies'>('feed')

  /** "Ask" is a question and stays in the chat. "Do" is a piece of work, so it gets a
   *  row in `tasks` — that is what the strip at the top is reading, and it is how the
   *  work is still findable tomorrow. Lem closes the row when it finishes. */
  async function startWork(text: string, mode: 'ask' | 'do') {
    if (mode === 'ask') { askLem(text); return }

    let seed = `Please do this: ${text}`
    try {
      const created = await records.create('tasks', {
        title: text.slice(0, 140),
        detail: text,
        status: 'working',
        source: 'manual',
        urgency: 2,
        opened_at: new Date().toISOString(),
      }) as { id?: string }
      if (created?.id) {
        seed = `Please do this: ${text}\n\n`
          + `(This is task ${created.id}. When you have finished, set that row's status to 'done' — `
          + `or 'dropped' if it turned out not to be needed — so it stops showing as running. `
          + `If the answer is a document, write the file and say in one line that it is ready.)`
      }
    } catch { /* the chat still works without the row */ }
    bump()
    askLem(seed)
  }

  const sits = useSql<SituationRow>(rev(
    `select s.id, s.title, s.summary, s.anchor, s.person_id, s.work_project_id, s.urgency,
            coalesce((select c.domain from work_projects w join companies c on c.id=w.company_id where w.id=s.work_project_id),
                     (select c.domain from companies c where c.id=s.company_id)) as domain,
            coalesce((select w.company_id from work_projects w where w.id=s.work_project_id), s.company_id) as open_company
     from situations s where s.status='active'
     order by coalesce(s.urgency,2) asc, s.last_seen_at desc nulls last`, version))

  const loops = useSql<LoopRow>(rev(
    `select l.id, l.side, l.kind, l.obligation, l.provenance, l.source, l.opened_at,
            l.urgency, l.urgency_reason, l.thread_ref, l.person_id, l.work_project_id, l.situation_id, l.due_at,
            coalesce(p.name,'') as person, p.avatar_url,
            (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft
     from loops l left join people p on p.id=l.person_id
     where l.status='open'
     order by coalesce(l.urgency,2) asc, l.opened_at asc nulls last`, version))

  const loading = sits.isLoading || loops.isLoading
  const all = loops.items

  // Situations first; anything not claimed by one still has to be visible.
  const claimed = new Set<string>()
  const blocks = sits.items.map((s) => {
    // The explicit link wins. Anchors are only a fallback for rows written
    // before Lem started stamping situation_id.
    const mine = all.filter((l) =>
      l.situation_id === s.id ||
      (!l.situation_id && s.work_project_id && l.work_project_id === s.work_project_id) ||
      (!l.situation_id && !s.work_project_id && s.person_id && l.person_id === s.person_id))
    mine.forEach((l) => claimed.add(l.id))
    return { s, loops: mine }
  }).filter((b) => b.loops.length > 0)

  const loose = all.filter((l) => !claimed.has(l.id))

  return (
    <div className="page">
      <div className="seg home-seg">
        <button className={view === 'feed' ? 'on' : ''} onClick={() => setView('feed')}>Needs you</button>
        <button className={view === 'people' ? 'on' : ''} onClick={() => setView('people')}>People</button>
        <button className={view === 'companies' ? 'on' : ''} onClick={() => setView('companies')}>Companies</button>
      </div>
      <Greeting name={userName} />
      <Ask onSend={(text, mode) => void startWork(text, mode)} />
      <Strip />

      {view !== 'feed' ? <Lens view={view} /> : (<>
      <Prepared />
      {loading ? <Loading />
        : blocks.length === 0 && loose.length === 0
          ? <Empty line="Nothing needs you right now." />
          : (
            <>
              {blocks.map((b) => <Block key={b.s.id} s={b.s} loops={b.loops} onChange={bump} />)}
              <Suggestions />
              {loose.length > 0 && (
                <div className="block">
                  <div className="block-top"><span className="block-name">Everything else</span></div>
                  <ItemList loops={loose} onChange={bump} limit={3} />
                </div>
              )}
            </>
          )}
      </>)}
    </div>
  )
}
