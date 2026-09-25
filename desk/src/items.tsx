import { useEffect, useRef, useState } from 'react'
import { Check, Clock, X, Send } from 'lucide-react'
import { ageLabel, type LoopRow } from './lib'
import { useQuickClose } from './closing'
import { useNav, useOpener } from './nav'

/* A commitment, as one sentence.

   The glyph says whose move it is — a filled ember dot is yours, a hollow ring is
   someone else's — so one list can hold both without splitting in two. Clicking the
   sentence opens it in Focus; clicking the name opens the person. Hovering offers the
   one-move closes, and J/K/E/S do the same from the keyboard. */

function Due({ l }: { l: LoopRow }) {
  if (l.due_at) {
    const due = new Date(l.due_at), today = new Date()
    const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const d1 = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
    const days = Math.round((d1 - d0) / 86400000)
    if (days < 0) return <span className="due over">{-days === 1 ? 'a day late' : `${-days}d late`}</span>
    if (days === 0) return <span className="due today">due today</span>
    if (days === 1) return <span className="due soon">tomorrow</span>
  }
  const age = ageLabel(l.opened_at)
  return age ? <span className="age">{age}</span> : null
}

export function Glyph({ side }: { side: string }) {
  return <span className={`glyph ${side === 'you' ? 'mine' : 'theirs'}`} aria-label={side === 'you' ? 'Your move' : 'Waiting on them'} />
}

export function ItemRow({ l, onChange }: { l: LoopRow; onChange: () => void }) {
  const { focus } = useNav()
  const open = useOpener()
  const quick = useQuickClose()
  const [leaving, setLeaving] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  const ready = Number(l.has_draft) > 0
  const selected = focus?.type === 'loop' && focus.id === l.id

  // A closed row strikes through and fades where it stands, then the list refreshes.
  const act = (what: 'done' | 'snooze' | 'dismiss') => {
    setLeaving(true)
    void quick(l, what, () => window.setTimeout(onChange, 520))
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onDone = () => act('done')
    const onSnooze = () => act('snooze')
    const onOpen = () => open({ type: 'loop', id: l.id })
    el.addEventListener('row:done', onDone)
    el.addEventListener('row:snooze', onSnooze)
    el.addEventListener('row:open', onOpen)
    return () => {
      el.removeEventListener('row:done', onDone)
      el.removeEventListener('row:snooze', onSnooze)
      el.removeEventListener('row:open', onOpen)
    }
  })

  return (
    <li ref={ref} data-row={l.id} className={`item${leaving ? ' leaving' : ''}${selected ? ' current' : ''}`}>
      <Glyph side={l.side} />
      <button className="item-t" onClick={() => open({ type: 'loop', id: l.id })}>{l.obligation}</button>
      <span className="item-meta">
        {ready && (
          <span className="ready-tag">
            <Send size={11} />
            {l.side === 'you' ? 'ready' : 'nudge ready'}
          </span>
        )}
        {l.side !== 'you' && l.person && (
          <button className="who" onClick={() => l.person_id && open({ type: 'person', id: l.person_id })}>
            {l.person.split(' ')[0]}
          </button>
        )}
        <Due l={l} />
      </span>
      <span className="item-acts" aria-label="Quick actions">
        <button title="Done (E)" onClick={() => act('done')}><Check size={14} /></button>
        <button title="Snooze a week (S)" onClick={() => act('snooze')}><Clock size={14} /></button>
        <button title="Not a thing" onClick={() => act('dismiss')}><X size={14} /></button>
      </span>
    </li>
  )
}

/** Most urgent first, your moves before waiting-on; the top few show, the rest one click away. */
export function ItemList({ loops, onChange, limit }: {
  loops: LoopRow[]; onChange: () => void; limit?: number
}) {
  const [all, setAll] = useState(false)
  const ranked = limit
    ? [...loops].sort((a, b) =>
        (a.side === 'you' ? 0 : 1) - (b.side === 'you' ? 0 : 1)
        || Number(a.urgency ?? 2) - Number(b.urgency ?? 2))
    : loops
  const shown = limit && !all ? ranked.slice(0, limit) : ranked
  const hidden = loops.length - shown.length
  return (
    <ul className="items">
      {shown.map((l) => <ItemRow key={l.id} l={l} onChange={onChange} />)}
      {hidden > 0 && <li className="more-li"><button className="more" onClick={() => setAll(true)}>{hidden} more</button></li>}
      {limit && all && loops.length > limit && (
        <li className="more-li"><button className="more" onClick={() => setAll(false)}>Show fewer</button></li>
      )}
    </ul>
  )
}

/** J / K move through every row on the page, Enter opens, E done, S snooze. */
export function useRowKeys() {
  useEffect(() => {
    let at = -1
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (t?.closest?.('input,textarea,[contenteditable],.lem.open,.palette')) return
      const rows = [...document.querySelectorAll<HTMLElement>('.main [data-row]')]
      if (!rows.length) return
      const k = e.key.toLowerCase()
      const cur = rows.findIndex((r) => r.classList.contains('sel'))
      if (cur >= 0) at = cur
      const pick = (i: number) => {
        rows.forEach((r) => r.classList.remove('sel'))
        at = Math.max(0, Math.min(rows.length - 1, i))
        rows[at].classList.add('sel')
        rows[at].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      if (k === 'j') { e.preventDefault(); pick(at + 1) }
      else if (k === 'k') { e.preventDefault(); pick(at - 1) }
      else if (at >= 0 && rows[at]) {
        if (k === 'enter') { e.preventDefault(); rows[at].dispatchEvent(new Event('row:open')) }
        if (k === 'e') { e.preventDefault(); rows[at].dispatchEvent(new Event('row:done')) }
        if (k === 's') { e.preventDefault(); rows[at].dispatchEvent(new Event('row:snooze')) }
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}
