import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { daysSince, fmtDate, useSql, rev } from '../lib'
import { Avatar, Logo } from '../ui'
import { useOpener, useNav } from '../nav'

/* One board shape for every pipeline — sales, hiring, anything with stages.

   - A funnel line on top says the whole board in one breath.
   - Columns deepen in tone as the funnel goes on; the winning stage is green, and the
     losing one folds into a count at the end instead of taking a whole column.
   - A card says who, where it last moved and why, what it's worth, how long it has sat in
     this stage (amber when it has gone stale), and carries an ember dot when the next
     move is yours. Clicking it opens that person or company in Focus. */

export interface BoardRow {
  id: string; stage: string; pos: number; name: string
  note?: string | null; person_id?: string | null; company_id?: string | null
  deal_value?: number | null; entered_stage_at?: string | null; expected_close_at?: string | null
  avatar_url?: string | null; domain?: string | null; mine?: number | null; track_id?: string | null
  [k: string]: unknown
}

/** Every board reads the same columns; only which cards it wants differs. */
export const boardSql = (where: string) => `
  select b.id, b.track_id, coalesce(s.name,'—') as stage, coalesce(s.position, 99) as pos,
         coalesce(p.name, c.name, '—') as name, b.last_move_reason as note, b.person_id, b.company_id,
         b.deal_value, b.entered_stage_at, b.expected_close_at, p.avatar_url,
         coalesce(c.domain, pc.domain) as domain,
         (select count(*) from loops l
           where l.status='open' and l.side='you'
             and (l.person_id = b.person_id
                  or (b.company_id is not null and l.person_id in (select x.id from people x where x.company_id = b.company_id)))) as mine
  from board_cards b
  left join stages s on s.id = b.stage_id
  left join people p on p.id = b.person_id
  left join companies c on c.id = b.company_id
  left join companies pc on pc.id = p.company_id
  where ${where}
  order by s.position nulls last, coalesce(p.name, c.name)`

const WON = /\b(won|joined|hired|signed|customer|live|closed won)\b/i
const LOST = /\b(lost|not moving|rejected|declined|dropped|passed|churned|closed lost|no longer)\b/i

const money = (v: number) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v % 1e7 ? 1 : 0)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v % 1e5 ? 1 : 0)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

function Card({ c, won }: { c: BoardRow; won: boolean }) {
  const open = useOpener()
  const days = daysSince(c.entered_stage_at)
  const stale = !won && days !== null && days >= 14
  const go = c.person_id ? () => open({ type: 'person', id: c.person_id! })
    : c.company_id ? () => open({ type: 'company', id: c.company_id! }) : undefined
  return (
    <button className="bcard" onClick={go} disabled={!go}>
      <span className="bcard-top">
        {c.person_id ? <Avatar name={c.name} src={c.avatar_url} size="xs" /> : <Logo name={c.name} domain={c.domain} />}
        <b>{c.name}</b>
        {Number(c.mine) > 0 && <span className="bcard-mine" title="Your move" />}
        {c.deal_value ? <span className="bcard-val">{money(Number(c.deal_value))}</span> : null}
      </span>
      {c.note && <small className="bcard-note">{c.note}</small>}
      {(days !== null || c.expected_close_at) && (
        <span className="bcard-foot">
          {days !== null && <span className={stale ? 'stale' : ''}>{days === 0 ? 'moved today' : `${days}d here`}</span>}
          {c.expected_close_at && !won && <span>closes {fmtDate(c.expected_close_at)}</span>}
        </span>
      )}
    </button>
  )
}

/** `stagesWhere` picks the board's own stages (e.g. `track_id = '…'`), so every stage the
 *  round or pipeline has shows as a column — empty ones included. */
export function Board({ rows, stagesWhere }: { rows: BoardRow[]; stagesWhere?: string }) {
  const { version } = useNav()
  const [showLost, setShowLost] = useState(false)
  const stages = useSql<{ name: string; position: number }>(rev(stagesWhere
    ? `select name, min(coalesce(position, 99)) as position from stages where ${stagesWhere} group by name` : null, version))
  const cols = useMemo(() => {
    const m = new Map<string, { pos: number; items: BoardRow[] }>()
    for (const s of stages.items) m.set(s.name, { pos: Number(s.position ?? 99), items: [] })
    for (const c of rows) {
      if (!m.has(c.stage)) m.set(c.stage, { pos: Number.isFinite(Number(c.pos)) ? Number(c.pos) : 99, items: [] })
      m.get(c.stage)!.items.push(c)
    }
    return [...m.entries()].sort((a, b) => a[1].pos - b[1].pos)
      .map(([name, v]) => ({ name, items: v.items, won: WON.test(name), lost: LOST.test(name) }))
  }, [rows, stages.items])

  const live = cols.filter((c) => !c.lost)
  const lost = cols.filter((c) => c.lost)
  const lostN = lost.reduce((n, c) => n + c.items.length, 0)
  const wonValue = cols.filter((c) => c.won).flatMap((c) => c.items).reduce((n, c) => n + Number(c.deal_value || 0), 0)
  const openValue = cols.filter((c) => !c.won && !c.lost).flatMap((c) => c.items).reduce((n, c) => n + Number(c.deal_value || 0), 0)
  const ahead = live.filter((c) => !c.won)

  return (
    <div className="pipe">
      <div className="funnel">
        {live.map((c, i) => (
          <span key={c.name} className={`fstep${c.won ? ' won' : ''}`}>
            {i > 0 && <ChevronRight size={12} className="fsep" />}
            {c.name} <b>{c.items.length}</b>
          </span>
        ))}
        {lostN > 0 && <span className="fstep lost">· {lostN} not moving</span>}
        {(openValue > 0 || wonValue > 0) && (
          <span className="fvalue">
            {openValue > 0 && <>{money(openValue)} in play</>}
            {openValue > 0 && wonValue > 0 && ' · '}
            {wonValue > 0 && <b>{money(wonValue)} won</b>}
          </span>
        )}
      </div>
      <div className="board">
        {live.map((c) => {
          const i = ahead.indexOf(c)
          const depth = c.won ? 1 : ahead.length > 1 ? i / (ahead.length - 1) : 0.5
          return (
            <div key={c.name} className={`col${c.won ? ' won' : ''}`} style={{ ['--depth' as string]: `${Math.round(25 + depth * 65)}%` }}>
              <div className="col-h"><span>{c.name}</span><span className="col-n">{c.items.length}</span></div>
              {c.items.map((x) => <Card key={x.id} c={x} won={c.won} />)}
              {c.items.length === 0 && <div className="col-empty">Nobody here yet</div>}
            </div>
          )
        })}
        {lost.length > 0 && (showLost
          ? lost.map((c) => (
            <div key={c.name} className="col lost">
              <button className="col-h" onClick={() => setShowLost(false)}><span>{c.name}</span><span className="col-n">{c.items.length}</span></button>
              {c.items.map((x) => <Card key={x.id} c={x} won={false} />)}
            </div>
          ))
          : (
            <button className="col-folded" onClick={() => setShowLost(true)} title="Show who isn't moving ahead">
              <b>{lostN}</b><span>{lost.map((c) => c.name).join(', ')}</span>
            </button>
          ))}
      </div>
    </div>
  )
}
