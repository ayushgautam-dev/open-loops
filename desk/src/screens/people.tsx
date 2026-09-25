import { useMemo, useState } from 'react'
import { useCurrentUser } from 'lemma-sdk/react'
import { Search, ChevronRight } from 'lucide-react'
import { useSql, rev, client, type PersonRow } from '../lib'
import { Avatar, Logo, Empty, Loading } from '../ui'
import { useNav } from '../nav'

/* The address book: everyone you have dealt with, in one searchable page.

   What is *open* with people lives on Today (by person, by company). This page is who you
   know, grouped the way an address book naturally is — your team, each company with its
   people under it, candidates, and individuals. No tabs, no filters; search reaches
   everyone. Companies with nothing going on are still here. */

const PERSONAL = /@(gmail|googlemail|yahoo|outlook|hotmail|icloud|me|proton|protonmail|live|rediffmail)\./i

interface P extends PersonRow { company_id?: string | null; domain?: string | null }
interface C { id: string; name: string; domain?: string | null; open_count: number; stage?: string | null; [k: string]: unknown }

function PersonTile({ p }: { p: P }) {
  const { open } = useNav()
  return (
    <button className="tile" onClick={() => open({ type: 'person', id: p.id })}>
      <Avatar name={p.name} src={p.avatar_url} size="md" />
      <span className="tile-t">
        <b>{p.name}</b>
        <small>{p.role || p.email}</small>
      </span>
      {Number(p.open_count) > 0 && <span className="count" title="Open with them">{p.open_count}</span>}
    </button>
  )
}

export function People() {
  const { version, open } = useNav()
  const { user } = useCurrentUser({ client })
  const myEmail = ((user as { email?: string } | undefined)?.email ?? '').toLowerCase()
  const myDomain = myEmail.split('@')[1] ?? ''
  const [q, setQ] = useState('')

  const people = useSql<P>(rev(
    `select p.id, p.name, p.email, p.role, p.avatar_url, p.relationship, p.company_id,
            coalesce(c.name,'') as company, lower(c.domain) as domain,
            (select count(*) from loops l where l.person_id=p.id and l.status='open') as open_count
     from people p left join companies c on c.id = p.company_id
     order by p.name asc`, version))

  const companies = useSql<C>(rev(
    `select c.id, c.name, c.domain,
       (select count(*) from loops l join people p on p.id=l.person_id where p.company_id=c.id and l.status='open') as open_count,
       (select s.name from board_cards b join tracks t on t.id=b.track_id and lower(t.name)='sales'
          left join stages s on s.id=b.stage_id where b.company_id=c.id limit 1) as stage
     from companies c
     order by c.name`, version))

  const needle = q.trim().toLowerCase()
  const has = (s: string) => !needle || s.toLowerCase().includes(needle)

  const { team, byCompany, candidates, individuals, total } = useMemo(() => {
    // you are not one of your own contacts, and neither is a bot writing as you
    const humans = people.items.filter((p) =>
      (p.email ?? '').toLowerCase() !== myEmail && !/ via lemma$/i.test(p.name) && !/@ops\.lemma\.work$/i.test(p.email ?? ''))
    const bucket = (p: P) => {
      const dom = (p.email ?? '').split('@')[1]?.toLowerCase() ?? ''
      if (p.relationship === 'teammate' || (myDomain && dom === myDomain)) return 'team'
      if (p.relationship === 'candidate') return 'candidates'
      if (!p.company_id || PERSONAL.test(p.email ?? '')) return 'individuals'
      return 'company'
    }
    const matchP = (p: P) => has(`${p.name} ${p.email ?? ''} ${p.role ?? ''} ${p.company ?? ''}`)
    const byCo = new Map<string, P[]>()
    for (const p of humans) if (bucket(p) === 'company' && p.company_id) {
      if (!byCo.has(p.company_id)) byCo.set(p.company_id, [])
      byCo.get(p.company_id)!.push(p)
    }
    const byCompany = companies.items
      .map((c) => {
        const all = byCo.get(c.id) ?? []
        // searching a company's name shows all its people; searching a person shows their company
        const list = has(`${c.name} ${c.domain ?? ''}`) ? all : all.filter(matchP)
        return { c, people: list, show: has(`${c.name} ${c.domain ?? ''}`) || list.length > 0 }
      })
      .filter((x) => x.show)
      .sort((a, b) => Number(b.c.open_count) - Number(a.c.open_count) || a.c.name.localeCompare(b.c.name))
    return {
      team: humans.filter((p) => bucket(p) === 'team' && matchP(p)),
      candidates: humans.filter((p) => bucket(p) === 'candidates' && matchP(p)),
      individuals: humans.filter((p) => bucket(p) === 'individuals' && matchP(p)),
      byCompany,
      total: humans.length,
    }
  }, [people.items, companies.items, needle, myEmail, myDomain])

  const loading = people.isLoading || companies.isLoading
  const nothing = !team.length && !byCompany.length && !candidates.length && !individuals.length

  return (
    <div className="page">
      <header className="page-h">
        <h1 className="display sm">People</h1>
        {!loading && <span className="muted">{total} people · {companies.items.length} companies</span>}
      </header>

      <div className="toolbar">
        <label className="search">
          <Search size={14} />
          <input placeholder="Search anyone, or any company…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {loading ? <Loading rows={6} /> : nothing ? <Empty line="Nobody matches that." /> : (
        <>
          {team.length > 0 && (
            <section className="book-sec">
              <div className="sec-h">Your team <span className="muted">{team.length}</span></div>
              <div className="grid">{team.map((p) => <PersonTile key={p.id} p={p} />)}</div>
            </section>
          )}

          {byCompany.length > 0 && (
            <section className="book-sec">
              <div className="sec-h">Companies <span className="muted">{byCompany.length}</span></div>
              <div className="book-cos">
                {byCompany.map(({ c, people: ps }) => (
                  <div key={c.id} className="book-co">
                    <button className="book-co-h" onClick={() => open({ type: 'company', id: c.id })}>
                      <Logo name={c.name} domain={c.domain} size="md" />
                      <span className="tile-t">
                        <b>{c.name}</b>
                        <small>{[c.stage === 'Won' ? 'Customer' : c.stage, c.domain].filter(Boolean).join(' · ')}</small>
                      </span>
                      {Number(c.open_count) > 0 && <span className="count" title="Open with them">{c.open_count}</span>}
                      <ChevronRight size={15} className="book-go" />
                    </button>
                    {ps.length > 0 && (
                      <div className="book-people">
                        {ps.map((p) => (
                          <button key={p.id} className="book-p" onClick={() => open({ type: 'person', id: p.id })}>
                            <Avatar name={p.name} src={p.avatar_url} size="xs" />
                            <span className="book-p-n">{p.name}</span>
                            {p.role && <span className="book-p-r">{p.role}</span>}
                            {Number(p.open_count) > 0 && <span className="count sm">{p.open_count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {candidates.length > 0 && (
            <section className="book-sec">
              <div className="sec-h">Candidates <span className="muted">{candidates.length}</span></div>
              <div className="grid">{candidates.map((p) => <PersonTile key={p.id} p={p} />)}</div>
            </section>
          )}

          {individuals.length > 0 && (
            <section className="book-sec">
              <div className="sec-h">Individuals <span className="muted">{individuals.length}</span></div>
              <div className="grid">{individuals.map((p) => <PersonTile key={p.id} p={p} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
