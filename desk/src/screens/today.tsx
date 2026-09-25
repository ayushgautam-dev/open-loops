import { useEffect, useMemo, useState } from 'react'
import { Send, CalendarPlus, FileText, ArrowRight, ChevronRight } from 'lucide-react'
import { useCurrentUser } from 'lemma-sdk/react'
import {
  client, useSql, records, rev, lit, greeting, fmtTime, startOfToday, endOfToday, cleanTitle,
  type LoopRow, type SituationRow,
} from '../lib'
import { Avatar, Faces, Logo, Empty, Loading, Orb } from '../ui'
import { useNav } from '../nav'
import { ItemList } from '../items'
import { useLem } from '../lem'
import { Correctable } from '../correct'
import { Board, boardSql, type BoardRow } from './board'
import { WeatherMark } from '../weather'

/* Today — read once, top to bottom, then get on with the day.

   1. The masthead: the date, the sky, the shape of the day as a ribbon.
   2. One sentence of counts that doubles as the filter.
   3. What Lem already prepared, as letters waiting for a yes.
   4. The stories — each workstream that needs you, in Lem's two lines, with its items.
   5. Anything Lem noticed you might want running.

   A workstream appears here only while it needs you. The queries are the old Feed's. */

type Filter = 'all' | 'you' | 'them'

interface Meet { id: string; title: string; starts_at: string; [k: string]: unknown }

function useNow(ms = 60000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t) }, [ms])
  return now
}

/* ---------------- masthead ---------------- */

/** The day's shape: a thin line of hours with each meeting marked and a pin for now,
 *  and beneath it the meetings themselves, in order — past ones spent, the next one lit. */
function Ribbon({ meets, now }: { meets: Meet[]; now: number }) {
  const day0 = new Date(); day0.setHours(0, 0, 0, 0)
  const hourOf = (iso: string) => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60 }
  const hours = meets.map((m) => hourOf(m.starts_at))
  const from = Math.min(8, ...hours.map(Math.floor))
  const to = Math.max(20, ...hours.map((h) => Math.ceil(h + 1)))
  const span = to - from
  const pct = (h: number) => ((h - from) / span) * 100
  const nowH = (now - day0.getTime()) / 3600000
  const ticks = Array.from({ length: span + 1 }, (_, i) => from + i).filter((h) => h % 3 === 0)
  const nextId = meets.find((m) => Date.parse(m.starts_at) >= now)?.id
  // "9 AM" where the clock is 12-hour, a bare "9" where it is 24-hour
  const h24 = /13/.test(new Date(2026, 0, 1, 13).toLocaleTimeString(undefined, { hour: 'numeric' }))
  const label = (h: number) => (h24 ? String(h) : new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' }))
  return (
    <div className="ribbon" aria-label="Today’s calendar">
      <div className="ribbon-track">
        {nowH > from && <span className="spent" style={{ width: `${Math.min(100, pct(nowH))}%` }} />}
        {meets.map((m) => {
          const h = hourOf(m.starts_at)
          return <span key={m.id} className={`mk${h + 0.5 < nowH ? ' past' : ''}${m.id === nextId ? ' next' : ''}`}
            style={{ left: `${pct(h)}%`, width: `${(0.5 / span) * 100}%` }} title={`${fmtTime(m.starts_at)} · ${cleanTitle(m.title)}`} />
        })}
        {nowH >= from && nowH <= to && <span className="now" style={{ left: `${pct(nowH)}%` }}><i /></span>}
      </div>
      <div className="ribbon-ticks">
        {ticks.map((h) => <span key={h} style={{ left: `${pct(h)}%` }}>{label(h)}</span>)}
      </div>
      <div className="agenda-row">
        {meets.map((m) => {
          const past = hourOf(m.starts_at) + 0.5 < nowH
          return (
            <span key={m.id} className={`mpill${past ? ' past' : ''}${m.id === nextId ? ' next' : ''}`}>
              <small>{fmtTime(m.starts_at)}</small> {cleanTitle(m.title)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Masthead({ name }: { name: string }) {
  const { version } = useNav()
  const now = useNow()
  const q = useSql<Meet>(rev(
    `select id, subject as title, occurred_at as starts_at
     from interactions
     where source='calendar' and kind='meeting'
       and occurred_at >= ${lit(startOfToday())}
       and occurred_at < ${lit(endOfToday())}
     order by occurred_at asc`, version))
  // Only the real calendar, and only what is still to come today.
  const next = q.items.find((m) => Date.parse(m.starts_at) >= now)
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <header className="masthead">
      <div className="eyebrow row-gap"><WeatherMark /> {date}</div>
      <h1 className="display">{greeting()}, {name}.</h1>
      <p className="lede">
        {next
          ? <>Next up, <b>{cleanTitle(next.title)}</b> at {fmtTime(next.starts_at)}.</>
          : q.items.length ? <>That’s the calendar done for today.</> : <>Nothing on your calendar today.</>}
      </p>
      {q.items.length > 0 && <Ribbon meets={q.items} now={now} />}
    </header>
  )
}

/* ---------------- ready for you ---------------- */

interface Ready {
  loop_id: string; kind: string; subject?: string | null; body?: string | null
  person: string; avatar_url?: string | null; obligation: string; side: string; docs: number
  [k: string]: unknown
}

function ReadyShelf() {
  const { version, open } = useNav()
  const q = useSql<Ready>(rev(
    `select distinct on (l.id) l.id as loop_id, coalesce(d.kind,'email') as kind, d.subject, d.body,
            coalesce(p.name,'') as person, p.avatar_url, l.obligation, l.side,
            (select count(*) from deliverables x where x.loop_id=l.id and x.status <> 'discarded') as docs
     from drafts d join loops l on l.id=d.loop_id and l.status='open'
     left join people p on p.id=l.person_id
     where d.status='pending'
     order by l.id, d.created_at desc`, version))
  if (!q.items.length) return null
  const verb = (r: Ready) => {
    const who = r.person.split(' ')[0] || 'them'
    if (Number(r.docs) > 0) return `Document for ${who}`
    if (r.kind === 'meeting') return `Times for ${who}`
    return r.side === 'them' ? `Nudge ${who}` : `Reply to ${who}`
  }
  const icon = (r: Ready) => Number(r.docs) > 0 ? <FileText size={12} /> : r.kind === 'meeting' ? <CalendarPlus size={12} /> : <Send size={12} />
  const preview = (r: Ready) => String(r.body ?? '').replace(/^(hi|hey|hello|dear)\s+[^,\n]+,?\s*/i, '').replace(/\s+/g, ' ').trim()
  return (
    <section className="shelf">
      <div className="sec-h"><Orb size={14} /> Ready for you <span className="muted">{q.items.length}</span></div>
      <div className="shelf-row">
        {q.items.map((r) => (
          <button key={r.loop_id} className="note" onClick={() => open({ type: 'loop', id: r.loop_id })}>
            <span className="note-top">
              <Avatar name={r.person || '?'} src={r.avatar_url} size="xs" />
              <span className="note-k">{icon(r)} {verb(r)}</span>
            </span>
            <span className="note-subj">{r.subject || r.obligation}</span>
            {preview(r)
              ? <span className="note-body">{preview(r)}</span>
              : <span className="note-body empty">A blank draft is started — write it, or let Lem.</span>}
            <span className="note-foot">
              <span className="note-for">{r.subject ? r.obligation : ''}</span>
              <span className="note-go">Review <ArrowRight size={12} /></span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ---------------- a story ---------------- */

function StoryCard({ s, loops, onChange }: { s: SituationRow & { domain?: string | null; open_company?: string | null }; loops: LoopRow[]; onChange: () => void }) {
  const { open } = useNav()
  const people = Array.from(
    new Map(loops.filter((l) => l.person).map((l) => [l.person, { id: l.person_id, name: l.person, avatar_url: l.avatar_url }])).values(),
  )
  const mine = loops.filter((l) => l.side === 'you').length
  /* A topic opens whole in Focus, by the same rule as the Feed in app/: a company-backed
     topic opens the company, a workstream opens the workstream, a person topic the person. */
  const target = s.open_company ? { type: 'company' as const, id: String(s.open_company) }
    : s.work_project_id ? { type: 'workstream' as const, id: s.work_project_id }
      : s.person_id ? { type: 'person' as const, id: s.person_id }
        : loops[0]?.person_id ? { type: 'person' as const, id: loops[0].person_id } : null
  return (
    <article className="card story-card">
      <header className="card-h">
        {s.domain ? <Logo name={s.title} domain={s.domain} /> : null}
        {target
          ? <button className="card-title" onClick={() => open(target)} title="Open"><h3>{s.title}</h3><ChevronRight size={16} /></button>
          : <h3>{s.title}</h3>}
        <span className="grow" />
        <Faces people={people} onPick={(id) => open({ type: 'person', id })} />
        <span className="card-meta">{mine ? <><b>{mine}</b> on you</> : `${loops.length} waiting`}</span>
      </header>
      {s.summary && <Correctable text={s.summary} kind="situation" subjectId={s.id} about={`the summary for "${s.title}"`} />}
      <ItemList loops={loops} onChange={onChange} limit={3} />
    </article>
  )
}

function Noticed() {
  const { version, bump } = useNav()
  const lem = useLem()
  const q = useSql<{ id: string; proposal: string; reason: string }>(rev(
    `select id, proposal, reason from suggestions where status='open'
     order by created_at desc limit 3`, version))
  if (!q.items.length) return null
  async function decide(id: string, status: 'added' | 'dismissed', proposal?: string) {
    await records.update('suggestions', id, { status })
    bump()
    if (status === 'added' && proposal) lem.ask(`Set this up for me as an autopilot: ${proposal}`)
  }
  return (
    <section className="noticed">
      <div className="sec-h"><Orb size={14} /> Lem noticed</div>
      {q.items.map((s) => (
        <div key={s.id} className="notice">
          <div className="notice-t">
            <b>{s.proposal}</b>
            <span>{s.reason}</span>
          </div>
          <div className="row-gap">
            <button className="btn ink sm" onClick={() => void decide(s.id, 'added', s.proposal)}>Set it up</button>
            <button className="btn ghost sm" onClick={() => void decide(s.id, 'dismissed')}>No thanks</button>
          </div>
        </div>
      ))}
    </section>
  )
}

/* ---------------- the page ---------------- */

/* ---------------- the same open items, grouped by person or by company ---------------- */

type Group = 'topic' | 'person' | 'company'

const PERSONAL = /@(gmail|googlemail|yahoo|outlook|hotmail|icloud|me|proton|protonmail|live|rediffmail)\./i

interface OpenRow extends LoopRow {
  person_email?: string | null; role?: string | null; relationship?: string | null
  company_id?: string | null; company?: string | null; company_domain?: string | null
}

/** Where a person belongs — the same rule as the old app's People/Companies lenses: someone
 *  at a company you deal with lives under that company, so People is your team,
 *  candidates and individuals. */
function bucketOf(l: OpenRow, myDomain: string): 'team' | 'candidates' | 'individuals' | 'company' {
  const dom = (l.person_email ?? '').split('@')[1]?.toLowerCase() ?? ''
  if (l.relationship === 'teammate' || (myDomain && dom === myDomain)) return 'team'
  if (l.relationship === 'candidate') return 'candidates'
  if (!l.company_id || PERSONAL.test(l.person_email ?? '')) return 'individuals'
  return 'company'
}

function PersonCard({ loops, onChange }: { loops: OpenRow[]; onChange: () => void }) {
  const { open } = useNav()
  const p = loops[0]
  const mine = loops.filter((l) => l.side === 'you').length
  return (
    <article className="card story-card">
      <header className="card-h">
        <button className="card-title with-face" onClick={() => p.person_id && open({ type: 'person', id: p.person_id })} title="Open">
          <Avatar name={p.person} src={p.avatar_url} size="sm" />
          <h3>{p.person || 'Someone'}</h3><ChevronRight size={16} />
        </button>
        {p.role && <span className="card-sub">{p.role}</span>}
        <span className="grow" />
        <span className="card-meta">{mine ? <><b>{mine}</b> on you</> : `${loops.length} waiting`}</span>
      </header>
      <ItemList loops={loops} onChange={onChange} limit={3} />
    </article>
  )
}

function CompanyCard({ loops, onChange }: { loops: OpenRow[]; onChange: () => void }) {
  const { open } = useNav()
  const c = loops[0]
  const people = Array.from(new Map(loops.filter((l) => l.person).map((l) => [l.person_id, { id: l.person_id, name: l.person, avatar_url: l.avatar_url }])).values())
  const mine = loops.filter((l) => l.side === 'you').length
  return (
    <article className="card story-card">
      <header className="card-h">
        <button className="card-title with-face" onClick={() => c.company_id && open({ type: 'company', id: c.company_id })} title="Open">
          <Logo name={c.company || '?'} domain={c.company_domain} />
          <h3>{c.company}</h3><ChevronRight size={16} />
        </button>
        <span className="grow" />
        <Faces people={people} onPick={(id) => open({ type: 'person', id })} />
        <span className="card-meta">{mine ? <><b>{mine}</b> on you</> : `${loops.length} waiting`}</span>
      </header>
      <ItemList loops={loops} onChange={onChange} limit={3} />
    </article>
  )
}

function groupBy(rows: OpenRow[], key: (l: OpenRow) => string | null | undefined): OpenRow[][] {
  const m = new Map<string, OpenRow[]>()
  for (const l of rows) {
    const k = key(l)
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(l)
  }
  // your moves first, then the most items
  return [...m.values()].sort((a, b) =>
    b.filter((l) => l.side === 'you').length - a.filter((l) => l.side === 'you').length || b.length - a.length)
}

/** A pipeline shown in place of the list, and a quiet way back. */
function BoardToggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <button className={`board-toggle${on ? ' on' : ''}`} onClick={() => set(!on)}>{on ? 'Show as list' : label}</button>
}

function ByPerson({ rows, myDomain, onChange, toCompanies }: {
  rows: OpenRow[]; myDomain: string; onChange: () => void; toCompanies: () => void
}) {
  const { version } = useNav()
  const [boards, setBoards] = useState(false)
  const hiring = useSql<BoardRow>(rev(boards
    ? boardSql(`b.track_id in (select id from tracks where lower(name)='hiring')`) : null, version))
  const rounds = useSql<{ id: string; round: string }>(rev(boards
    ? `select t.id, coalesce((select w.title from work_projects w where w.track_id=t.id
                    and (w.archived is null or w.archived=false) order by w.last_met_at desc nulls last limit 1), t.name) as round
       from tracks t where lower(t.name)='hiring'` : null, version))
  const sections: { key: 'team' | 'candidates' | 'individuals'; label: string }[] = [
    { key: 'team', label: 'Your team' }, { key: 'candidates', label: 'Candidates' }, { key: 'individuals', label: 'Individuals' },
  ]
  const atCompanies = rows.filter((l) => bucketOf(l, myDomain) === 'company')
  const any = sections.some((sec) => rows.some((l) => bucketOf(l, myDomain) === sec.key))
  return (
    <div className="stories">
      {sections.map((sec) => {
        const own = rows.filter((l) => bucketOf(l, myDomain) === sec.key)
        if (!own.length && !(sec.key === 'candidates' && boards)) return null
        return (
          <section key={sec.key} className="group-sec">
            <div className="sec-h">{sec.label}
              {sec.key === 'candidates' && <><span className="grow" /><BoardToggle label="Show as board" on={boards} set={setBoards} /></>}
            </div>
            {sec.key === 'candidates' && boards
              ? (rounds.items.length ? rounds.items.map((r) => (
                  <div key={r.id} className="round">
                    <div className="round-h">{r.round}</div>
                    <Board rows={hiring.items.filter((c) => c.track_id === r.id)} stagesWhere={`track_id = ${lit(r.id)}`} />
                  </div>
                )) : <Loading rows={2} />)
              : <div className="cardgrid">{groupBy(own, (l) => l.person_id).map((g) => <PersonCard key={g[0].person_id} loops={g} onChange={onChange} />)}</div>}
          </section>
        )
      })}
      {!any && !boards && <Empty line="Nothing open with anyone outside a company." />}
      {atCompanies.length > 0 && (
        <button className="group-more" onClick={toCompanies}>
          {atCompanies.length} more with people at companies <ChevronRight size={13} />
        </button>
      )}
    </div>
  )
}

function ByCompany({ rows, myDomain, onChange, toPeople }: {
  rows: OpenRow[]; myDomain: string; onChange: () => void; toPeople: () => void
}) {
  const { version } = useNav()
  const [pipeline, setPipeline] = useState(false)
  const sales = useSql<BoardRow>(rev(pipeline
    ? boardSql(`b.track_id in (select id from tracks where lower(name)='sales')`) : null, version))
  const own = rows.filter((l) => bucketOf(l, myDomain) === 'company')
  const elsewhere = rows.length - own.length
  return (
    <div className="stories">
      <div className="sec-h">Companies<span className="grow" /><BoardToggle label="Show sales pipeline" on={pipeline} set={setPipeline} /></div>
      {pipeline
        ? (sales.isLoading ? <Loading rows={3} /> : sales.items.length ? <Board rows={sales.items} stagesWhere={`track_id in (select id from tracks where lower(name)='sales')`} /> : <Empty line="No sales pipeline yet." />)
        : own.length
          ? <div className="cardgrid">{groupBy(own, (l) => l.company_id).map((g) => <CompanyCard key={g[0].company_id} loops={g} onChange={onChange} />)}</div>
          : <Empty line="Nothing open with any company." />}
      {!pipeline && elsewhere > 0 && (
        <button className="group-more" onClick={toPeople}>
          {elsewhere} more with your team, candidates and individuals <ChevronRight size={13} />
        </button>
      )}
    </div>
  )
}

export function Today({ userName }: { userName: string }) {
  const { version, bump } = useNav()
  const { user } = useCurrentUser({ client })
  const myDomain = (((user as { email?: string } | undefined)?.email ?? '').split('@')[1] ?? '').toLowerCase()
  const [filter, setFilter] = useState<Filter>('all')
  const [group, setGroup] = useState<Group>(() => {
    try { return (localStorage.getItem('desk-group') as Group) || 'topic' } catch { return 'topic' }
  })
  const pick = (g: Group) => { setGroup(g); try { localStorage.setItem('desk-group', g) } catch { /* fine */ } }

  const sits = useSql<SituationRow & { domain?: string | null; open_company?: string | null }>(rev(
    `select s.id, s.title, s.summary, s.anchor, s.person_id, s.work_project_id, s.urgency,
            coalesce((select c.domain from work_projects w join companies c on c.id=w.company_id where w.id=s.work_project_id),
                     (select c.domain from companies c where c.id=s.company_id)) as domain,
            coalesce((select w.company_id from work_projects w where w.id=s.work_project_id), s.company_id) as open_company
     from situations s where s.status='active'
     order by coalesce(s.urgency,2) asc, s.last_seen_at desc nulls last`, version))

  const loops = useSql<OpenRow>(rev(
    `select l.id, l.side, l.kind, l.obligation, l.provenance, l.source, l.opened_at,
            l.urgency, l.urgency_reason, l.thread_ref, l.person_id, l.work_project_id, l.situation_id, l.due_at,
            coalesce(p.name,'') as person, p.avatar_url, p.email as person_email, p.role, p.relationship,
            p.company_id, coalesce(c.name,'') as company, c.domain as company_domain,
            (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft
     from loops l left join people p on p.id=l.person_id
     left join companies c on c.id=p.company_id
     where l.status='open'
     order by coalesce(l.urgency,2) asc, l.opened_at asc nulls last`, version))

  const loading = sits.isLoading || loops.isLoading
  const all = loops.items
  const mine = all.filter((l) => l.side === 'you').length
  const theirs = all.length - mine
  const shown = filter === 'all' ? all : all.filter((l) => (filter === 'you') === (l.side === 'you'))

  const { blocks, loose } = useMemo(() => {
    const claimed = new Set<string>()
    const blocks = sits.items.map((s) => {
      // the explicit link wins; anchors are a fallback for rows written before situation_id
      const own = shown.filter((l) =>
        l.situation_id === s.id ||
        (!l.situation_id && s.work_project_id && l.work_project_id === s.work_project_id) ||
        (!l.situation_id && !s.work_project_id && s.person_id && l.person_id === s.person_id))
      own.forEach((l) => claimed.add(l.id))
      return { s, loops: own }
    }).filter((b) => b.loops.length > 0)
    return { blocks, loose: shown.filter((l) => !claimed.has(l.id)) }
  }, [sits.items, shown])

  const Chip = ({ f, n, label }: { f: Filter; n: number; label: string }) => (
    <button className={`count-chip${filter === f ? ' on' : ''}${f === 'you' ? ' mine' : f === 'them' ? ' theirs' : ''}`}
      onClick={() => setFilter(filter === f ? 'all' : f)}>
      <b>{n}</b> {label}
    </button>
  )

  return (
    <div className="page today">
      <Masthead name={userName} />

      {!loading && all.length > 0 && (
        <div className="tally">
          <Chip f="you" n={mine} label="on you" />
          <span className="tally-sep">·</span>
          <Chip f="them" n={theirs} label="waiting on others" />
          {filter !== 'all' && <button className="link-q" onClick={() => setFilter('all')}>Show all</button>}
          <span className="grow" />
          <span className="groupby" role="radiogroup" aria-label="Group by">
            <span className="groupby-k">by</span>
            {(['topic', 'person', 'company'] as Group[]).map((g) => (
              <button key={g} role="radio" aria-checked={group === g} className={group === g ? 'on' : ''} onClick={() => pick(g)}>
                {g === 'topic' ? 'Topic' : g === 'person' ? 'Person' : 'Company'}
              </button>
            ))}
          </span>
        </div>
      )}

      {filter !== 'them' && <ReadyShelf />}

      {loading ? <Loading rows={4} />
        : all.length === 0 ? (
          <div className="clear">
            <div className="display sm">Nothing needs you.</div>
            <p className="lede">Lem will put things here as they come in.</p>
          </div>
        ) : (
          <>
            {group === 'person' ? (
              <ByPerson rows={shown} myDomain={myDomain} onChange={bump} toCompanies={() => pick('company')} />
            ) : group === 'company' ? (
              <ByCompany rows={shown} myDomain={myDomain} onChange={bump} toPeople={() => pick('person')} />
            ) : (
              <div className="stories">
                {blocks.map((b) => <StoryCard key={b.s.id} s={b.s} loops={b.loops} onChange={bump} />)}
                {loose.length > 0 && (
                  <article className="card story-card">
                    <header className="card-h"><h3>Everything else</h3><span className="grow" /><span className="card-meta">{loose.length}</span></header>
                    <ItemList loops={loose} onChange={bump} limit={4} />
                  </article>
                )}
                {blocks.length === 0 && loose.length === 0 && <Empty line="Nothing in this view." />}
              </div>
            )}
            <Noticed />
            <div className="keys-hint"><kbd>J</kbd><kbd>K</kbd> move · <kbd>↵</kbd> open · <kbd>E</kbd> done · <kbd>S</kbd> snooze · <kbd>/</kbd> ask Lem</div>
          </>
        )}
    </div>
  )
}
