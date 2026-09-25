import { useState } from 'react'
import { ageLabel, type LoopRow } from './lib'
import { CloseControls } from './closing'
import { useNav } from './nav'

/* A commitment row. The sentence is the interface: clicking it opens the detail
   in place — why it is open, the draft Lem already wrote, and the actions.
   Clicking the person opens their drawer instead. Two targets, two results. */

function Detail({ loop, onDone }: { loop: LoopRow; onDone: () => void }) {
  const { openSheet } = useNav()
  const first = (loop.person || 'them').split(' ')[0]
  const ready = Number(loop.has_draft) > 0
  const isMail = !!loop.thread_ref && /^[0-9a-f]{10,24}$/.test(loop.thread_ref)

  /* Prepared work never opens inline: it goes to the workspace beside the page, where
     the conversation and the draft can be read together. */
  return (
    <div className="detail">
      {(loop.urgency_reason || isMail) && (
        <p className="why">
          {loop.urgency_reason}
          {isMail && (
            <button className="inline-link" onClick={() => openSheet({ type: 'loop', id: loop.id })}>View thread →</button>
          )}
        </p>
      )}
      <CloseControls loop={loop} onClosed={onDone}>
        {loop.side === 'you' ? (
          <button className="btn primary" onClick={() => openSheet({ type: 'loop', id: loop.id })}>
            {ready ? 'Review what Lem prepared' : 'Open'}
          </button>
        ) : (
          <button className="btn primary" onClick={() => openSheet({ type: 'loop', id: loop.id, nudge: true })}>
            Nudge {first}
          </button>
        )}
      </CloseControls>
    </div>
  )
}

/** How long it has sat, or — when there is a date — how close it is. Overdue is red,
 *  due today amber; everything else stays quiet grey. */
function Due({ l }: { l: LoopRow }) {
  if (l.due_at) {
    const due = new Date(l.due_at), today = new Date()
    const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const d1 = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
    const days = Math.round((d1 - d0) / 86400000)
    if (days < 0) return <span className="due over"> · {-days === 1 ? 'a day late' : `${-days} days late`}</span>
    if (days === 0) return <span className="due today"> · due today</span>
    if (days === 1) return <span className="due soon"> · due tomorrow</span>
  }
  const age = ageLabel(l.opened_at)
  return <>{age ? ` · ${age}` : ''}</>
}

/** `limit` shows only the first few — the list arrives most-urgent first, so the top
 *  three are the ones that matter; the rest are one click away, never gone. */
export function ItemList({ loops, highlight, onChange, limit }: {
  loops: LoopRow[]; highlight?: string | null; onChange: () => void; limit?: number
}) {
  const { openSheet } = useNav()
  const [open, setOpen] = useState<string | null>(highlight ?? null)
  const [all, setAll] = useState(false)
  // A closed row strikes through and fades where it stands, then the list refreshes —
  // instead of the whole page blinking.
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const leave = (id: string) => {
    setOpen(null)
    setLeaving((s) => new Set(s).add(id))
    window.setTimeout(() => { onChange(); setLeaving((s) => { const n = new Set(s); n.delete(id); return n }) }, 650)
  }
  // When only a few show, what you owe beats what you're waiting on, then urgency.
  const ranked = limit
    ? [...loops].sort((a, b) =>
        (a.side === 'you' ? 0 : 1) - (b.side === 'you' ? 0 : 1)
        || Number(a.urgency ?? 2) - Number(b.urgency ?? 2))
    : loops
  const shown = limit && !all ? ranked.slice(0, limit) : ranked
  const hidden = loops.length - shown.length

  return (
    <ul className="items">
      {shown.map((l) => {
        const isOpen = open === l.id
        return (
          <li key={l.id} className={leaving.has(l.id) ? 'leaving' : ''} style={{ display: 'block', padding: 0 }}>
            <div className="item">
              <span className={`dot${l.side === 'you' ? ' f' : ''}`} />
              <button className="txt" onClick={() => setOpen(isOpen ? null : l.id)}>
                {l.obligation}
              </button>
              <span className="o">
                {Number(l.has_draft) > 0 && <span className="ready">{l.side === 'you' ? 'ready to send' : 'nudge ready'}</span>}
                {l.side === 'you' ? 'you' : (
                  <button className="link" style={{ fontSize: 12.5 }}
                    onClick={() => l.person_id && openSheet({ type: 'person', id: l.person_id })}>
                    {l.person || 'them'}
                  </button>
                )}
                <Due l={l} />
              </span>
            </div>
            {isOpen && (
              <Detail loop={l} onDone={() => leave(l.id)} />
            )}
          </li>
        )
      })}
      {hidden > 0 && (
        <li style={{ display: 'block', padding: 0 }}>
          <button className="more" style={{ marginTop: 4 }} onClick={() => setAll(true)}>{hidden} more</button>
        </li>
      )}
      {limit && all && loops.length > limit && (
        <li style={{ display: 'block', padding: 0 }}>
          <button className="more" style={{ marginTop: 4 }} onClick={() => setAll(false)}>Show fewer</button>
        </li>
      )}
    </ul>
  )
}
