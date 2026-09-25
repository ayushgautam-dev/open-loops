import { useEffect, useState } from 'react'
import { X, Maximize2, Minimize2, MessageCircle, Sparkles, Mail, NotebookPen, CalendarDays, Layers, FileText } from 'lucide-react'
import {
  useSql, rev, lit, ageLabel, fmtDate, records, isGmailThread,
  type PersonRow, type LoopRow, type TimelineRow,
} from './lib'
import { Avatar, Logo, Markdown, Empty, Loading, Orb } from './ui'
import { Board, boardSql, type BoardRow } from './screens/board'
import { useNav, focusKey, InFocus, type Focus } from './nav'
import { ItemList, Glyph } from './items'
import { CloseBar } from './closing'
import { Conversation } from './thread'
import { Prepared, Paper, LemNote, draftForLoop, useDocsForLoop, type DraftRow } from './prepared'
import { useLem } from './lem'

/* Focus: the panel beside the page — a strip of tabs, one per thing you have open. */

interface TabInfo { label: string; side?: string; avatar_url?: string | null; domain?: string | null; [k: string]: unknown }

function tabSql(f: Focus): string {
  if (f.type === 'person') return `select name as label, avatar_url from people where id=${lit(f.id)}`
  if (f.type === 'company') return `select name as label, domain from companies where id=${lit(f.id)}`
  if (f.type === 'doc') return `select title as label from deliverables where id=${lit(f.id)}`
  if (f.type === 'workstream') return `select w.title as label, c.domain from work_projects w left join companies c on c.id=w.company_id where w.id=${lit(f.id)}`
  return `select obligation as label, side from loops where id=${lit(f.id)}`
}

/** One tab: the thing's own face (a logo, a person, whose move it is) and a short name. */
function TabHandle({ f, on, onPick, onClose }: { f: Focus; on: boolean; onPick: () => void; onClose: () => void }) {
  const { version } = useNav()
  const q = useSql<TabInfo>(rev(tabSql(f), version))
  const t = q.items[0]
  const label = t?.label ?? '…'
  const face = f.type === 'person' ? <Avatar name={label} src={t?.avatar_url} size="xs" />
    : f.type === 'company' ? <Logo name={label} domain={t?.domain} />
      : f.type === 'workstream' ? (t?.domain ? <Logo name={label} domain={t.domain} /> : <span className="tab-ic"><Layers size={13} /></span>)
        : f.type === 'doc' ? <span className="tab-ic"><FileText size={13} /></span>
          : <span className="tab-ic"><Glyph side={String(t?.side ?? 'you')} /></span>
  return (
    <div className={`ftab${on ? ' on' : ''}`} title={label}>
      <button className="ftab-l" onClick={onPick}>{face}<span>{label}</span></button>
      <button className="ftab-x" aria-label={`Close ${label}`} onClick={onClose}><X size={12} /></button>
    </div>
  )
}

/* ---------------- an item ---------------- */

interface LoopFull extends LoopRow { company_id?: string | null; status: string }

function SourceIcon({ l }: { l: LoopRow }) {
  if (isGmailThread(l.thread_ref)) return <span className="src" title="From email"><Mail size={12} /> Email</span>
  if (l.thread_ref?.startsWith('granola:')) return <span className="src" title="From meeting notes"><NotebookPen size={12} /> Meeting notes</span>
  if (l.source === 'calendar') return <span className="src"><CalendarDays size={12} /> Calendar</span>
  return null
}

function ItemFocus({ f }: { f: Extract<Focus, { type: 'loop' }> }) {
  const { version, bump, closeTab, push } = useNav()
  const lem = useLem()
  const q = useSql<LoopFull>(rev(
    `select l.id, l.side, l.kind, l.status, l.obligation, l.provenance, l.urgency_reason, l.thread_ref,
            l.opened_at, l.due_at, l.source, l.person_id, coalesce(p.name,'') as person, p.email as person_email, p.avatar_url,
            p.company_id, coalesce(c.name,'') as company
     from loops l left join people p on p.id=l.person_id left join companies c on c.id=p.company_id
     where l.id=${lit(f.id)} limit 1`, version))
  const dq = useSql<DraftRow>(rev(draftForLoop(f.id), version))
  const docs = useDocsForLoop(f.id)
  const l = q.items[0]
  const draft = dq.items[0]
  const first = (l?.person || 'them').split(' ')[0]
  const [making, setMaking] = useState(false)
  const leave = () => { bump(); closeTab(focusKey(f)) }

  // A nudge starts as a real pending draft on the same conversation — the same write as before.
  async function startNudge() {
    if (!l || draft || making) return
    setMaking(true)
    try {
      await records.create('drafts', {
        loop_id: l.id, to_person_id: l.person_id, kind: 'email', status: 'pending',
        subject: '', body: `Hi ${first},\n\n`,
        to_emails: l.person_email ? [l.person_email] : [],
        note: `A nudge to ${first}, on the same conversation. Write it, or let Lem.`,
      })
      bump()
    } finally { setMaking(false) }
  }
  useEffect(() => { if (f.nudge && l && !draft && !dq.isLoading) void startNudge() }, [f.nudge, l?.id, dq.isLoading])

  if (q.isLoading && !l) return <div className="focus-body"><Loading /></div>
  if (!l) return <div className="focus-body"><Empty line="This item is gone." /></div>

  const lemWrite = () => lem.ask(
    l.side === 'them'
      ? `Write a short nudge to ${l.person} about "${l.obligation}" (commitment ${l.id}) in my voice, as a reply on the same conversation. Put it in the pending draft for that commitment if there is one. End with the card marker.`
      : `Prepare "${l.obligation}" for me (commitment ${l.id}). Use the open-loops-write skill and pick the right shape. End with the card marker.`,
    { key: `loop:${l.id}`, title: l.obligation, about: `the commitment "${l.obligation}" (loop_id ${l.id})` })

  const hasWork = !!draft || docs.items.length > 0

  return (
    <>
      <div className="focus-body">
        <div className="if-eyebrow">
          <Glyph side={l.side} />
          <span>{l.side === 'you' ? 'Your move' : `Waiting on ${first}`}</span>
          {l.opened_at && <span className="dotsep">{ageLabel(l.opened_at)}</span>}
          {l.status !== 'open' && <span className="dotsep">{l.status}</span>}
          <span className="grow" />
          <SourceIcon l={l} />
        </div>
        <h2 className="if-title">{l.obligation}</h2>
        {l.person && (
          <button className="if-who" onClick={() => l.person_id && push({ type: 'person', id: l.person_id })}>
            <Avatar name={l.person} src={l.avatar_url} size="xs" />
            <span>{l.person}</span>
            {l.company && <span className="muted">· {l.company}</span>}
          </button>
        )}
        {l.urgency_reason && <blockquote className="why">{l.urgency_reason}</blockquote>}

        {isGmailThread(l.thread_ref)
          ? <Conversation threadRef={l.thread_ref!} />
          : <p className="prov">{l.provenance || (l.thread_ref?.startsWith('granola:') ? 'From your meeting notes.' : 'No email conversation for this one.')}</p>}

        {hasWork ? (
          <div className="prepared">
            <div className="prepared-h"><Orb size={14} /> Lem prepared</div>
            {draft && <LemNote text={draft.note} />}
            {draft && <Prepared draft={draft} docs={docs.items} onSent={leave} />}
            {docs.items.map((d) => <Paper key={d.id} doc={d} />)}
          </div>
        ) : (
          <div className="unprepared">
            <Orb size={22} />
            <div>
              <b>{l.side === 'you' ? 'Nothing prepared yet.' : `Want to nudge ${first}?`}</b>
              <span>{l.side === 'you' ? 'Lem can write it in your voice — you still press send.' : 'A short follow-up on the same conversation.'}</span>
            </div>
            {l.side === 'you'
              ? <button className="btn lem" onClick={lemWrite}><Sparkles size={13} /> Prepare it</button>
              : <button className="btn lem" disabled={making} onClick={() => void startNudge()}>Nudge {first}</button>}
          </div>
        )}
      </div>

      <div className="focus-foot">
        <CloseBar loop={l} onClosed={leave} lead={
          <>
            {hasWork && (
              <button className="btn ghost sm" onClick={lemWrite}>
                <Sparkles size={13} /> {l.side === 'them' && draft ? 'Let Lem write it' : 'Redo with Lem'}
              </button>
            )}
            <button className="btn ghost sm" onClick={() => lem.show({ key: `loop:${l.id}`, title: l.obligation, about: `the commitment "${l.obligation}" (loop_id ${l.id})` })}>
              <MessageCircle size={13} /> Ask
            </button>
          </>
        } />
      </div>
    </>
  )
}

/* ---------------- a person ---------------- */

/* The story of the relationship, not a log — the same filtering as before: meetings that
   happened, what was decided or delivered, promises kept (including your own notes), and
   none of the admin (invites, accepts, reschedules, bare calendar rows). */

const NOISE = /(accept|declin|invit|rsvp|resched|calendar notification|waiting in the meet|moved (the|to)|join(ed)? the (call|meet)|reminder)/i

interface Story { id: string; when: string; kind: 'meeting' | 'email' | 'note' | 'done'; title: string; quote?: string | null; cal?: boolean }

function toStory(events: TimelineRow[], closed: { id: string; obligation: string; close_reason?: string | null; closed_at?: string | null; closed_by?: string | null }[]): Story[] {
  const now = Date.now()
  const rows: Story[] = []
  for (const e of events) {
    if (!e.happened_at || Date.parse(e.happened_at) > now) continue
    if (NOISE.test(e.title)) continue
    const kind: Story['kind'] = e.type === 'loop_closed' ? 'done' : e.type === 'meeting' ? 'meeting' : e.type === 'email' ? 'email' : 'note'
    rows.push({ id: e.id, when: e.happened_at, kind, title: e.title, quote: e.quote, cal: e.source === 'calendar' })
  }
  const said = new Set(rows.filter((r) => r.kind === 'done').map((r) => r.title.slice(0, 40)))
  for (const l of closed) {
    if (!l.closed_at || l.closed_by !== 'manual') continue
    if (/\b(confirm|schedul|reschedul|slot|a time|invite)\b/i.test(l.obligation)) continue
    if (said.has(l.obligation.slice(0, 40))) continue
    const why = l.close_reason && !/^You (marked|said)/.test(l.close_reason) ? ` — ${l.close_reason.charAt(0).toLowerCase()}${l.close_reason.slice(1)}` : ''
    rows.push({ id: `l:${l.id}`, when: l.closed_at, kind: 'done', title: `${l.obligation}${why}` })
  }
  const bare = (r: Story) => r.kind === 'meeting' && (!!r.cal || !/[—;:]/.test(r.title))
  const rich = rows.filter((r) => r.kind === 'meeting' && !bare(r))
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (bare(r) && rich.some((x) => Math.abs(Date.parse(x.when) - Date.parse(r.when)) < 2.5 * 86400000)) rows.splice(i, 1)
  }
  rows.sort((x, y) => y.when.localeCompare(x.when))
  const out: Story[] = []
  for (const r of rows) {
    const day = r.when.slice(0, 10)
    const twin = out.find((o) => o.kind === r.kind && o.when.slice(0, 10) === day && (r.kind === 'meeting' || o.title.slice(0, 30) === r.title.slice(0, 30)))
    if (twin) { if (r.title.length > twin.title.length) Object.assign(twin, r); continue }
    out.push(r)
  }
  return out
}

const KIND_MARK: Record<Story['kind'], string> = { meeting: 'Met', email: 'Wrote', note: 'Note', done: 'Done' }

function StoryView({ items, stands }: { items: Story[]; stands?: string | null }) {
  const [open, setOpen] = useState<string | null>(null)
  const months = new Map<string, Story[]>()
  for (const s of items) {
    const k = new Date(s.when).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    if (!months.has(k)) months.set(k, [])
    months.get(k)!.push(s)
  }
  return (
    <div className="story">
      {stands && (
        <div className="stands">
          <div className="eyebrow">Where you stand</div>
          <p>{(stands.match(/[^.!?]+[.!?]+/g) ?? [stands]).slice(0, 2).join(' ').trim()}</p>
        </div>
      )}
      {items.length === 0 && <Empty line="Nothing worth recording yet." />}
      {[...months.entries()].map(([m, list]) => (
        <section key={m} className="story-m">
          <div className="story-mh">{m}</div>
          <ol className="story-l">
            {list.map((s) => (
              <li key={s.id} className={`story-r k-${s.kind}${s.quote ? ' has' : ''}`} onClick={() => s.quote && setOpen(open === s.id ? null : s.id)}>
                <span className="story-dot" />
                <span className="story-d">{new Date(s.when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                <span className="story-t">
                  <span className="story-k">{KIND_MARK[s.kind]}</span> {s.title}
                  {open === s.id && s.quote && <span className="story-q">{s.quote}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

type PTab = 'open' | 'story' | 'docs' | 'about'

function PersonFocus({ f }: { f: Extract<Focus, { type: 'person' }> }) {
  const { version, bump, push } = useNav()
  const lem = useLem()
  const [view, setView] = useState<PTab>('open')
  const id = f.id

  const q = useSql<PersonRow & { company_id?: string | null; domain?: string | null }>(rev(
    `select p.id, p.name, p.email, p.role, p.avatar_url, p.context, p.research,
            p.relationship, p.company_id, coalesce(c.name,'') as company, c.domain
     from people p left join companies c on c.id = p.company_id
     where p.id=${lit(id)} limit 1`, version))
  const loops = useSql<LoopRow>(rev(
    `select l.id, l.side, l.kind, l.obligation, l.provenance, l.opened_at, l.due_at,
            l.urgency, l.urgency_reason, l.thread_ref, l.person_id, l.source,
            coalesce(p.name,'') as person, p.avatar_url,
            (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft
     from loops l left join people p on p.id=l.person_id
     where l.person_id=${lit(id)} and l.status='open'
     order by coalesce(l.urgency,2) asc`, version))
  const tl = useSql<TimelineRow>(rev(view === 'story'
    ? `select id, type, title, quote, happened_at, source from timeline_events
       where person_id=${lit(id)} order by happened_at desc nulls last limit 200`
    : null, version))
  const kept = useSql<{ id: string; obligation: string; close_reason?: string; closed_at?: string; closed_by?: string }>(rev(view === 'story'
    ? `select id, obligation, close_reason, closed_at, closed_by from loops
       where person_id=${lit(id)} and status='closed' order by closed_at desc limit 60`
    : null, version))
  const docs = useSql<{ id: string; title: string; created_at?: string }>(rev(view === 'docs'
    ? `select d.id, d.title, d.created_at from deliverables d
       left join tasks t on t.id = d.task_id
       left join loops l on l.id = d.loop_id
       where t.person_id=${lit(id)} or l.person_id=${lit(id)}
       order by d.created_at desc limit 40`
    : null, version))

  const p = q.items[0]
  const n = loops.items.length
  return (
    <div className="focus-body">
      <div className="hero">
        <Avatar name={p?.name} src={p?.avatar_url} size="lg" />
        <div className="hero-t">
          <h2>{p?.name ?? '…'}</h2>
          <div className="hero-s">
            {p?.role && <span>{p.role}</span>}
            {p?.role && (p?.company || p?.email) && <span className="sep">·</span>}
            {p?.company && p.company_id
              ? <button className="link" onClick={() => push({ type: 'company', id: p.company_id! })}>{p.company}</button>
              : p?.email && <span>{p.email}</span>}
          </div>
        </div>
        <button className="btn line sm" onClick={() => lem.show({
          key: `person:${id}`, title: p?.name ?? 'Person',
          about: p ? `${p.name}${p.company ? ` at ${p.company}` : ''} (person_id ${id})` : `person_id ${id}`,
        })}><MessageCircle size={13} /> Ask Lem</button>
      </div>
      <div className="tabs">
        {(['open', 'story', 'docs', 'about'] as PTab[]).map((t) => (
          <button key={t} className={view === t ? 'on' : ''} onClick={() => setView(t)}>
            {t === 'open' ? <>Open{n ? <span className="tab-n">{n}</span> : null}</> : t === 'story' ? 'Story' : t === 'docs' ? 'Docs' : 'About'}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {view === 'open' && (loops.isLoading ? <Loading />
          : n === 0 ? <Empty line="Nothing open with them." />
            : <ItemList loops={loops.items} onChange={bump} />)}
        {view === 'story' && (tl.isLoading ? <Loading rows={5} />
          : <StoryView items={toStory(tl.items, kept.items)} stands={p?.context} />)}
        {view === 'docs' && (docs.isLoading ? <Loading />
          : docs.items.length === 0 ? <Empty line="Nothing written about them yet." />
            : <div className="doclist">{docs.items.map((d) => (
              <button key={d.id} className="docrow" onClick={() => push({ type: 'doc', id: d.id })}>
                <span className="docrow-t">{d.title}</span><span className="muted">{fmtDate(d.created_at)}</span>
              </button>))}</div>)}
        {view === 'about' && (p?.research || p?.context
          ? <div className="prose"><Markdown text={p.research || p.context || ''} /></div>
          : <Empty line="Lem hasn’t written them up yet." />)}
      </div>
    </div>
  )
}

/* ---------------- a company ---------------- */

function CompanyFocus({ f }: { f: Extract<Focus, { type: 'company' }> }) {
  const { version, bump, push } = useNav()
  const lem = useLem()
  const c = useSql<{ id: string; name: string; domain?: string; what?: string; context?: string }>(rev(
    `select id, name, domain, what, context from companies where id=${lit(f.id)}`, version)).items[0]
  const ws = useSql<{ id: string; title: string; stands?: string; cadence?: string; raise_next?: string }>(rev(
    `select id, title, stands, cadence, raise_next from work_projects where company_id=${lit(f.id)} and (archived is null or archived=false)`, version)).items[0]
  const people = useSql<PersonRow>(rev(
    `select p.id, p.name, p.email, p.role, p.avatar_url,
            (select count(*) from loops l where l.person_id=p.id and l.status='open') as open_count
     from people p where p.company_id=${lit(f.id)} order by open_count desc, p.name`, version))
  const loops = useSql<LoopRow>(rev(
    `select l.id, l.side, l.kind, l.obligation, l.provenance, l.opened_at, l.due_at, l.urgency, l.urgency_reason,
            l.thread_ref, l.person_id, l.source, coalesce(p.name,'') as person, p.avatar_url,
            (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft
     from loops l join people p on p.id=l.person_id
     where p.company_id=${lit(f.id)} and l.status='open' order by coalesce(l.urgency,2)`, version))
  if (!c) return <div className="focus-body"><Loading /></div>
  const stands = ws?.stands || c.what
  return (
    <div className="focus-body">
      <div className="hero">
        <Logo name={c.name} domain={c.domain} size="lg" />
        <div className="hero-t">
          <h2>{c.name}</h2>
          <div className="hero-s">{[ws?.cadence, c.domain].filter(Boolean).join(' · ')}</div>
        </div>
        <button className="btn line sm" onClick={() => lem.show({
          key: `company:${f.id}`, title: `About ${c.name}`, about: `${c.name} (company_id ${f.id})`,
        })}><MessageCircle size={13} /> Ask Lem</button>
      </div>
      {stands && <div className="stands"><div className="eyebrow">Where it stands</div><p>{stands}</p></div>}
      {worthRaising(ws?.raise_next) && (
        <div className="agenda"><div className="eyebrow">Raise next time</div><Markdown text={String(ws!.raise_next)} /></div>
      )}
      <div className="sec-h">Open <span className="muted">{loops.items.length || ''}</span></div>
      {loops.items.length ? <ItemList loops={loops.items} onChange={bump} /> : <Empty line="Nothing open with them." />}
      <div className="sec-h">People</div>
      <div className="plist">
        {people.items.map((p) => (
          <button key={p.id} className="prow" onClick={() => push({ type: 'person', id: p.id })}>
            <Avatar name={p.name} src={p.avatar_url} />
            <span className="prow-t"><b>{p.name}</b><small>{p.role || p.email}</small></span>
            {Number(p.open_count) > 0 && <span className="count">{p.open_count} open</span>}
          </button>
        ))}
      </div>
    </div>
  )
}


/* ---------------- a workstream ---------------- */

export const worthRaising = (r?: string | null) => {
  const t = String(r ?? '').trim()
  return !!t && !/^nothing worth raising\.?$/i.test(t)
}

const KIND_LABEL: Record<string, string> = { hiring: 'Hiring round', project: 'Project', meeting: 'Recurring meeting', account: 'Account' }

/** A hiring round, a project or a recurring meeting, opened whole: where it stands, what to
 *  raise next time, everything open in it, the people in it, and its board if it has one. */
function WorkstreamFocus({ f }: { f: Extract<Focus, { type: 'workstream' }> }) {
  const { version, bump, push } = useNav()
  const lem = useLem()
  const w = useSql<{ id: string; title: string; kind?: string; cadence?: string; stands?: string; raise_next?: string; track_id?: string; company_id?: string; domain?: string; company?: string }>(rev(
    `select w.id, w.title, w.kind, w.cadence, w.stands, w.raise_next, w.track_id, w.company_id, c.domain, c.name as company
     from work_projects w left join companies c on c.id=w.company_id where w.id=${lit(f.id)} limit 1`, version)).items[0]
  const loops = useSql<LoopRow>(rev(
    `select l.id, l.side, l.kind, l.obligation, l.provenance, l.opened_at, l.due_at, l.urgency, l.urgency_reason,
            l.thread_ref, l.person_id, l.source, coalesce(p.name,'') as person, p.avatar_url,
            (select count(*) from drafts d where d.loop_id=l.id and d.status='pending') as has_draft
     from loops l left join people p on p.id=l.person_id
     where l.work_project_id=${lit(f.id)} and l.status='open' order by coalesce(l.urgency,2)`, version))
  const cards = useSql<BoardRow>(rev(w?.track_id ? boardSql(`b.track_id = ${lit(w.track_id)}`) : null, version))
  if (!w) return <div className="focus-body"><Loading /></div>
  const people = Array.from(new Map(loops.items.filter((l) => l.person_id)
    .map((l) => [l.person_id, { id: l.person_id as string, name: l.person, avatar_url: l.avatar_url }])).values())
  const sub = [...new Set([KIND_LABEL[w.kind ?? ''] ?? '', w.cadence].filter(Boolean))]
  return (
    <div className="focus-body">
      <div className="hero">
        {w.domain ? <Logo name={w.company || w.title} domain={w.domain} size="lg" /> : <span className="ws-mark"><Layers size={26} /></span>}
        <div className="hero-t">
          <h2>{w.title}</h2>
          <div className="hero-s">
            {sub.join(' · ')}
            {w.company_id && w.company && <>{sub.length ? <span className="sep">·</span> : null}
              <button className="link" onClick={() => push({ type: 'company', id: w.company_id! })}>{w.company}</button></>}
          </div>
        </div>
        <button className="btn line sm" onClick={() => lem.show({
          key: `workstream:${w.id}`, title: w.title, about: `the workstream "${w.title}" (work_project_id ${w.id})`,
        })}><MessageCircle size={13} /> Ask Lem</button>
      </div>
      {w.stands && <div className="stands"><div className="eyebrow">Where it stands</div><p>{w.stands}</p></div>}
      {worthRaising(w.raise_next) && (
        <div className="agenda"><div className="eyebrow">Raise next time</div><Markdown text={String(w.raise_next)} /></div>
      )}
      <div className="sec-h">Open <span className="muted">{loops.items.length || ''}</span></div>
      {loops.items.length ? <ItemList loops={loops.items} onChange={bump} /> : <Empty line="Nothing open." />}
      {people.length > 0 && (
        <>
          <div className="sec-h">People</div>
          <div className="plist">
            {people.map((p) => (
              <button key={p.id} className="prow" onClick={() => push({ type: 'person', id: p.id })}>
                <Avatar name={p.name} src={p.avatar_url} />
                <span className="prow-t"><b>{p.name}</b></span>
              </button>
            ))}
          </div>
        </>
      )}
      {cards.items.length > 0 && (
        <>
          <div className="sec-h">Board</div>
          <Board rows={cards.items} stagesWhere={`track_id = ${lit(String(w.track_id))}`} />
        </>
      )}
    </div>
  )
}

/* ---------------- a document ---------------- */

function DocFocus({ f }: { f: Extract<Focus, { type: 'doc' }> }) {
  const { version } = useNav()
  const q = useSql<{ id: string; title: string; body: string; doc_url?: string; created_at?: string }>(rev(
    `select id, title, body, doc_url, created_at from deliverables where id=${lit(f.id)} limit 1`, version))
  const d = q.items[0]
  if (q.isLoading && !d) return <div className="focus-body"><Loading rows={6} /></div>
  if (!d) return <div className="focus-body"><Empty line="Not found." /></div>
  return <div className="focus-body paperbg"><Paper doc={d} reader /></div>
}

/* ---------------- the panel ---------------- */

export function FocusPanel() {
  const { tabs, focus, focusTab, closeTab, close, wide, setWide } = useNav()
  if (!focus) return null
  const k = focusKey(focus)
  return (
    <aside className="focus" aria-label="Focus">
      <div className="focus-top">
        <div className="ftabs" role="tablist">
          {tabs.map((t) => {
            const tk = focusKey(t)
            return <TabHandle key={tk} f={t} on={tk === k} onPick={() => focusTab(tk)} onClose={() => closeTab(tk)} />
          })}
        </div>
        <button className="icon-btn" title={wide ? 'Narrower' : 'Wider'} onClick={() => setWide(!wide)}>
          {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="icon-btn" title="Close all" onClick={close}><X size={16} /></button>
      </div>
      <InFocus.Provider value>
      <div className="focus-view" key={k}>
        {focus.type === 'loop' && <ItemFocus f={focus} />}
        {focus.type === 'person' && <PersonFocus f={focus} />}
        {focus.type === 'company' && <CompanyFocus f={focus} />}
        {focus.type === 'workstream' && <WorkstreamFocus f={focus} />}
        {focus.type === 'doc' && <DocFocus f={focus} />}
      </div>
      </InFocus.Provider>
    </aside>
  )
}
