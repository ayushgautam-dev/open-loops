import { useMemo, useState } from 'react'
import { useCurrentUser } from 'lemma-sdk/react'
import { useSql, rev, client, type PersonRow } from '../lib'
import { Avatar, Empty, Loading } from '../ui'
import { useNav } from '../nav'

/* The home page's People and Companies views — only who something is open with.
   (The People page in the rail is the full address book.)

   Who you deal with, in one place each.

   A person who works at a company you deal with lives under that company — you are
   selling to Acme, not to one person there — so they are not repeated in People.
   People is for the humans who are not "a company" to you: your own team (same email
   domain), candidates, and individuals (personal addresses, or no company at all).
   Search finds anyone, wherever they live.

   A filter only exists when something is in it. No "Vendors" chip with nothing behind
   it; the Sales filter shows the pipeline as a board rather than a list. */

const PERSONAL = /@(gmail|googlemail|yahoo|outlook|hotmail|icloud|me|proton|protonmail|live|rediffmail)\./i

interface P extends PersonRow { company_id?: string | null; domain?: string | null }
interface C {
  id: string; name: string; domain?: string | null
  open_count: number; done_count: number; people_count: number
  sales_stage?: string | null; sales_note?: string | null; stage_pos?: number | null
  deal_value?: number | null; is_investor?: boolean; is_vendor?: boolean; is_partner?: boolean
  [k: string]: unknown
}

function Chips<T extends string>({ opts, value, onChange }: {
  opts: { key: T; label: string; n: number }[]; value: T; onChange: (v: T) => void
}) {
  // A chip earns its place only if it shows something different from "All" — except
  // Sales, which is a different view (the pipeline board), not just a narrower list.
  const allN = opts.find((o) => o.key === ('all' as T))?.n ?? 0
  const shown = opts.filter((o) => o.key === ('all' as T)
    || (o.n > 0 && (o.n !== allN || o.key === ('sales' as T) || String(o.key).startsWith('round:'))))
  if (shown.length <= 1) return null
  return (
    <div className="fchips">
      {shown.map((o) => (
        <button key={o.key} className={`fchip${value === o.key ? ' on' : ''}`} onClick={() => onChange(o.key)}>
          {o.label}<span>{o.n}</span>
        </button>
      ))}
    </div>
  )
}

function Logo({ c }: { c: { name: string; domain?: string | null } }) {
  return (
    <span className="logo">
      {c.domain ? <img src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=64`} alt="" /> : c.name[0]}
    </span>
  )
}

function Board({ rows }: { rows: C[] }) {
  const { openSheet } = useNav()
  const stages = useMemo(() => {
    const m = new Map<string, { pos: number; items: C[] }>()
    for (const r of rows) {
      const k = r.sales_stage || 'Other'
      if (!m.has(k)) m.set(k, { pos: Number(r.stage_pos ?? 99), items: [] })
      m.get(k)!.items.push(r)
    }
    return [...m.entries()].sort((a, b) => a[1].pos - b[1].pos)
  }, [rows])
  return (
    <div className="board"><div className="cols">
      {stages.map(([st, { items }]) => (
        <div key={st}>
          <div className="col-h"><span>{st}</span><span>{items.length}</span></div>
          {items.map((c) => (
            <button key={c.id} className="card" style={{ width: '100%', textAlign: 'left' }}
              onClick={() => openSheet({ type: 'company', id: c.id })}>
              <div>
                <b>{c.name}{c.deal_value ? <span className="deal"> ₹{Number(c.deal_value).toLocaleString('en-IN')}</span> : null}</b>
                {c.sales_note && <small>{c.sales_note}</small>}
              </div>
            </button>
          ))}
        </div>
      ))}
    </div></div>
  )
}

interface HCard { id: string; person_id: string; name: string; stage: string; pos: number; note?: string | null; [k: string]: unknown }

/** The hiring round as a board — the People view's counterpart to the Sales pipeline. */
function HiringBoard({ cards }: { cards: HCard[] }) {
  const { openSheet } = useNav()
  const stages = useMemo(() => {
    const m = new Map<string, { pos: number; items: HCard[] }>()
    for (const c of cards) {
      if (!m.has(c.stage)) m.set(c.stage, { pos: Number(c.pos ?? 99), items: [] })
      m.get(c.stage)!.items.push(c)
    }
    return [...m.entries()].sort((a, b) => a[1].pos - b[1].pos)
  }, [cards])
  return (
    <div className="board"><div className="cols">
      {stages.map(([st, { items }]) => (
        <div key={st}>
          <div className="col-h"><span>{st}</span><span>{items.length}</span></div>
          {items.map((c) => (
            <button key={c.id} className="card" style={{ width: '100%', textAlign: 'left' }}
              onClick={() => openSheet({ type: 'person', id: c.person_id })}>
              <div><b>{c.name}</b>{c.note && <small>{c.note}</small>}</div>
            </button>
          ))}
        </div>
      ))}
    </div></div>
  )
}

export function Lens({ view }: { view: 'people' | 'companies' }) {
  const { version, openSheet } = useNav()
  const { user } = useCurrentUser({ client })
  const myDomain = ((user as { email?: string } | undefined)?.email ?? '').split('@')[1]?.toLowerCase() ?? ''
  const [pf, setPf] = useState<string>('all')
  const [cf, setCf] = useState<'all' | 'customers' | 'sales' | 'investors' | 'vendors' | 'partners'>('all')
  const q = ''

  const people = useSql<P>(rev(
    `select p.id, p.name, p.email, p.role, p.avatar_url, p.relationship, p.company_id,
            coalesce(c.name,'') as company, lower(c.domain) as domain,
            (select count(*) from loops l where l.person_id=p.id and l.status='open') as open_count
     from people p left join companies c on c.id = p.company_id
     order by open_count desc, p.name asc`, version))

  // Each hiring round is its own filter, named after the round ("Product
  // Builder-in-Residence"), never the generic word "Hiring".
  const hiring = useSql<HCard & { track_id: string; round: string }>(rev(
    `select b.id, b.person_id, b.track_id, p.name, coalesce(s.name,'—') as stage, coalesce(s.position, 99) as pos,
            b.last_move_reason as note,
            coalesce((select w.title from work_projects w where w.track_id=b.track_id
                      and (w.archived is null or w.archived=false) order by w.last_met_at desc nulls last limit 1),
                     t.name) as round
     from board_cards b join tracks t on t.id=b.track_id and lower(t.name)='hiring'
     join people p on p.id=b.person_id
     left join stages s on s.id=b.stage_id
     order by s.position nulls last, p.name`, version))
  const rounds = [...new Map(hiring.items.map((c) => [`round:${c.track_id}`, { key: `round:${c.track_id}`, label: c.round, n: 0 }])).values()]
  for (const r of rounds) r.n = hiring.items.filter((c) => `round:${c.track_id}` === r.key).length

  const companies = useSql<C>(rev(
    `select c.id, c.name, c.domain,
       (select count(*) from loops l join people p on p.id=l.person_id where p.company_id=c.id and l.status='open') as open_count,
       (select count(*) from loops l join people p on p.id=l.person_id where p.company_id=c.id and l.status='closed'
          and l.closed_at > now() - interval '60 days') as done_count,
       (select count(*) from people p where p.company_id=c.id) as people_count,
       sb.stage as sales_stage, sb.note as sales_note, sb.pos as stage_pos, sb.deal_value,
       exists (select 1 from board_cards b join tracks t on t.id=b.track_id
               where lower(t.name)='fundraising' and b.company_id=c.id)
         or exists (select 1 from people p where p.company_id=c.id and p.relationship='investor') as is_investor,
       exists (select 1 from people p where p.company_id=c.id and p.relationship='vendor') as is_vendor,
       exists (select 1 from people p where p.company_id=c.id and p.relationship='partner') as is_partner
     from companies c
     left join lateral (
       select s.name as stage, s.position as pos, b.last_move_reason as note, b.deal_value
       from board_cards b join tracks t on t.id=b.track_id and lower(t.name)='sales'
       left join stages s on s.id=b.stage_id
       where b.company_id=c.id limit 1) sb on true
     order by open_count desc, c.name`, version))

  const needle = q.trim().toLowerCase()
  const match = (s: string) => !needle || s.toLowerCase().includes(needle)

  // where a person belongs
  const bucket = (p: P): 'team' | 'candidates' | 'individuals' | 'company' => {
    const dom = (p.email ?? '').split('@')[1]?.toLowerCase() ?? ''
    if (p.relationship === 'teammate' || (myDomain && dom === myDomain)) return 'team'
    if (p.relationship === 'candidate') return 'candidates'
    if (!p.company_id || PERSONAL.test(p.email ?? '')) return 'individuals'
    return 'company'
  }
  const myEmail = ((user as { email?: string } | undefined)?.email ?? '').toLowerCase()
  // you are not one of your own contacts, and neither is a bot writing as you
  const humans = people.items.filter((p) =>
    (p.email ?? '').toLowerCase() !== myEmail && !/ via lemma$/i.test(p.name) && !/@ops\.lemma\.work$/i.test(p.email ?? ''))
  const own = humans.filter((p) => bucket(p) !== 'company' && Number(p.open_count) > 0)
  const pCounts = {
    team: own.filter((p) => bucket(p) === 'team').length,
    candidates: own.filter((p) => bucket(p) === 'candidates').length,
    individuals: own.filter((p) => bucket(p) === 'individuals').length,
  }
  // searching reaches everyone, including people who live under a company
  const pList = (needle ? humans : own)
    .filter((p) => needle || pf === 'all' || pf.startsWith('round:') || bucket(p) === pf)
    .filter((p) => match(`${p.name} ${p.email ?? ''} ${p.company ?? ''} ${p.role ?? ''}`))

  // a company worth listing is one something has actually happened with
  const real = companies.items.filter((c) => Number(c.open_count) > 0)
  // the board is the whole pipeline, not only the deals with something open today
  const pipeline = companies.items.filter((c) => c.sales_stage)
  const cat = (c: C) => ({
    customers: c.sales_stage === 'Won',
    sales: !!c.sales_stage,
    investors: !!c.is_investor,
    vendors: !!c.is_vendor,
    partners: !!c.is_partner,
  })
  const cCounts = {
    customers: real.filter((c) => cat(c).customers).length,
    sales: real.filter((c) => cat(c).sales).length,
    investors: real.filter((c) => cat(c).investors).length,
    vendors: real.filter((c) => cat(c).vendors).length,
    partners: real.filter((c) => cat(c).partners).length,
  }
  const cList = real
    .filter((c) => cf === 'all' || cat(c)[cf])
    .filter((c) => match(`${c.name} ${c.domain ?? ''}`))

  const loading = people.isLoading || companies.isLoading

  return (
    <div>
      {loading ? <Loading /> : view === 'people' ? (
        <>
          <Chips value={pf} onChange={setPf} opts={[
            { key: 'all', label: 'All', n: own.length },
            { key: 'team', label: 'Team', n: pCounts.team },
            { key: 'candidates', label: 'Candidates', n: pCounts.candidates },
            { key: 'individuals', label: 'Individuals', n: pCounts.individuals },
            ...rounds,
          ]} />
          {pf.startsWith('round:') ? <HiringBoard cards={hiring.items.filter((c) => `round:${c.track_id}` === pf)} /> : pList.length === 0 ? <Empty line="Nothing open with anyone outside a company." /> : pList.map((p) => (
            <button key={p.id} className="row" onClick={() => openSheet({ type: 'person', id: p.id })}>
              <Avatar name={p.name} src={p.avatar_url} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="nm">{p.name}</span>
                <span className="ds" style={{ display: 'block' }}>
                  {[p.role, p.company].filter(Boolean).join(' · ') || p.email}
                </span>
              </span>
              <span className="rt"><span className="tago">{p.open_count} open</span></span>
            </button>
          ))}
        </>
      ) : (
        <>
          <Chips value={cf} onChange={setCf} opts={[
            { key: 'all', label: 'All', n: real.length },
            { key: 'customers', label: 'Customers', n: cCounts.customers },
            { key: 'sales', label: 'Sales', n: pipeline.length },
            { key: 'investors', label: 'Investors', n: cCounts.investors },
            { key: 'vendors', label: 'Vendors', n: cCounts.vendors },
            { key: 'partners', label: 'Partners', n: cCounts.partners },
          ]} />
          {cf === 'sales' ? <Board rows={pipeline} /> : cList.length === 0 ? <Empty line="Nothing open with any company." /> : cList.map((c) => (
            <button key={c.id} className="row" onClick={() => openSheet({ type: 'company', id: c.id })}>
              <Logo c={c} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="nm">{c.name}</span>
                <span className="ds" style={{ display: 'block' }}>
                  {[c.sales_stage === 'Won' ? 'Customer' : c.sales_stage, c.domain,
                    Number(c.people_count) ? `${c.people_count} ${Number(c.people_count) === 1 ? 'person' : 'people'}` : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="rt">
                {Number(c.done_count) > 0 && <span className="tagd">✓ {c.done_count} done</span>}
                <span className="tago">{c.open_count} open</span>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
