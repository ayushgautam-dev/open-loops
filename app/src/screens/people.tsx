import { useState } from 'react'
import { useCurrentUser } from 'lemma-sdk/react'
import { useSql, rev, client, type PersonRow } from '../lib'
import { Avatar, Empty, Loading } from '../ui'
import { useNav } from '../nav'

/* Everyone you have dealt with from this address — the whole address book, searchable.
   Who has something open lives on the home page's People and Companies views. */

export function People() {
  const { version, openSheet } = useNav()
  const { user } = useCurrentUser({ client })
  const myEmail = ((user as { email?: string } | undefined)?.email ?? '').toLowerCase()
  const [q, setQ] = useState('')

  const rows = useSql<PersonRow>(rev(
    `select p.id, p.name, p.email, p.role, p.avatar_url, p.relationship,
            coalesce(c.name,'') as company,
            (select count(*) from loops l where l.person_id=p.id and l.status='open') as open_count
     from people p left join companies c on c.id = p.company_id
     order by p.name asc`, version))

  // you are not one of your own contacts, and neither is a bot writing as you
  const people = rows.items.filter((p) =>
    (p.email ?? '').toLowerCase() !== myEmail && !/ via lemma$/i.test(p.name) && !/@ops\.lemma\.work$/i.test(p.email ?? ''))
  const list = people.filter((p) => {
    if (!q.trim()) return true
    const hay = `${p.name} ${p.email ?? ''} ${p.company ?? ''} ${p.role ?? ''}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  return (
    <div className="page">
      <h1>People</h1>
      <div className="sub">{people.length} people</div>

      <div className="ask" style={{ padding: '9px 12px', marginBottom: 18 }}>
        <input
          style={{ width: '100%', border: 0, outline: 0, background: 'none' }}
          placeholder="Search people…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {rows.isLoading ? <Loading />
        : list.length === 0 ? <Empty line="Nobody matches that." />
        : list.map((p) => (
          <button key={p.id} className="row"
            onClick={() => openSheet({ type: 'person', id: p.id })}>
            <Avatar name={p.name} src={p.avatar_url} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="nm">{p.name}</span>
              <span className="ds" style={{ display: 'block' }}>
                {[p.role, p.company].filter(Boolean).join(' · ') || p.email}
              </span>
            </span>
            <span className="rt">
              {Number(p.open_count) > 0 ? `${p.open_count} open` : ''}
            </span>
          </button>
        ))}
    </div>
  )
}
