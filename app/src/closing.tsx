import { useState } from 'react'
import { Check, Clock, X } from 'lucide-react'
import { records, sql, lit, type LoopRow } from './lib'
import { useToast } from './ui'

/* Closing an item, with the context Lem cannot see.

   Done stays one click. Under it, an optional "how?" — because much of the work happens
   where Lem cannot look (WhatsApp, a call, in person), and "no longer needed" is a
   different fact from "done". Whatever is chosen becomes the close reason Lem reads, and
   one line on the person's timeline ("Sent Priya the demo pack — on WhatsApp"), so the
   relationship's history includes what happened off email. */

type How = { label: string; reason: string; status: 'closed' | 'dropped' }
const DONE_HOW: How[] = [
  { label: 'On WhatsApp or a call', reason: 'Done off email (WhatsApp or a call)', status: 'closed' },
  { label: 'No longer needed', reason: 'No longer needed', status: 'closed' },
]

export async function closeLoop(loop: LoopRow, status: 'closed' | 'dropped' | 'parked', reason: string) {
  const now = new Date().toISOString()
  const patch = status === 'parked'
    ? { status, parked_until: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }
    : { status, closed_at: now, closed_by: 'manual', close_reason: reason }
  await records.update('loops', loop.id, patch)
  // a draft for something that is finished must not read as "ready to send"
  if (status !== 'parked') {
    try {
      const drafts = await sql<{ id: string }>(`select id from drafts where loop_id=${lit(loop.id)} and status='pending'`)
      for (const d of drafts) await records.update('drafts', d.id, { status: 'skipped' })
    } catch { /* tidy-up retires them overnight anyway */ }
  }
  if (status !== 'parked' && loop.person_id) {
    const what = status === 'dropped' ? `Dismissed: ${loop.obligation}` : loop.obligation
    const tail = reason && !/^You (marked|said)/.test(reason) ? ` — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : ''
    try {
      await records.create('timeline_events', {
        person_id: loop.person_id, type: 'loop_closed', source: 'system',
        title: `${what}${tail}`.slice(0, 300), happened_at: now, ref: `loop:${loop.id}`,
      })
    } catch { /* the close is what matters */ }
  }
}

/** A dismissal is a preference, not just a status: Lem reads `corrections` before it
 *  writes anything, so "don't raise things like this" survives beyond this one row. */
async function rememberDismissal(loop: LoopRow, why: string) {
  try {
    await records.create('corrections', {
      about: `a commitment Lem raised with ${loop.person || 'someone'}`,
      was: loop.obligation,
      correction: why && !/^You said/.test(why)
        ? `Dismissed: ${why}. Don't raise things like this again.`
        : "Dismissed as not worth tracking. Don't raise things like this again.",
      subject_kind: 'commitment', subject_id: loop.id, applied: false,
    })
  } catch { /* the dismissal itself already landed */ }
}

export async function reopenLoop(loop: LoopRow) {
  await records.update('loops', loop.id, {
    status: 'open', closed_at: null, closed_by: null, close_reason: null, parked_until: null,
  })
}

/** Done · Snooze · Dismiss, with the optional "how?" beneath Done and Dismiss. */
export function CloseControls({ loop, onClosed, children }: {
  loop: LoopRow; onClosed: () => void; children?: React.ReactNode
}) {
  const toast = useToast()
  const [ask, setAsk] = useState<null | 'done' | 'drop'>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function finish(status: 'closed' | 'dropped' | 'parked', reason: string) {
    if (busy) return
    setBusy(true)
    await closeLoop(loop, status, reason)
    if (status === 'dropped') await rememberDismissal(loop, reason)
    toast(status === 'parked' ? 'Back in a week' : status === 'closed' ? 'Marked done' : 'Dismissed',
      async () => { await reopenLoop(loop); onClosed() })
    setBusy(false); setAsk(null); setNote('')
    onClosed()
  }

  /* One layout for every item: whatever this item needs (Review, Nudge, Prepare) on the
     left — it changes width, so it leads — and Done · Snooze · Dismiss always in the
     same place on the right. */
  return (
    <>
      <div className="actbar">
        <div className="act-left">{children}</div>
        <div className="act-right">
          <button className={`act${ask === 'done' ? ' on' : ''}`} onClick={() => setAsk(ask === 'done' ? null : 'done')}>
            <Check size={14} /> Done
          </button>
          <button className="act" onClick={() => void finish('parked', '')}><Clock size={14} /> Snooze</button>
          <button className={`act${ask === 'drop' ? ' on' : ''}`} onClick={() => setAsk(ask === 'drop' ? null : 'drop')}>
            <X size={14} /> Dismiss
          </button>
        </div>
      </div>
      {ask && (
        <div className="howbox">
          {ask === 'done' && (
            <div className="how-chips">
              <button className="how" onClick={() => void finish('closed', 'You marked this done')}>Just done</button>
              {DONE_HOW.map((h) => (
                <button key={h.label} className="how" onClick={() => void finish(h.status, h.reason)}>{h.label}</button>
              ))}
            </div>
          )}
          <div className="how-note">
            <input
              autoFocus value={note}
              placeholder={ask === 'done' ? 'Or say what happened — "sent the deck on WhatsApp"' : 'Why? (optional) — Lem will stop raising things like it'}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = note.trim()
                  void finish(ask === 'done' ? 'closed' : 'dropped',
                    n || (ask === 'done' ? 'You marked this done' : 'You said this was not a real thing'))
                }
                if (e.key === 'Escape') setAsk(null)
              }}
            />
            <button className="btn primary" disabled={busy} onClick={() => {
              const n = note.trim()
              void finish(ask === 'done' ? 'closed' : 'dropped',
                n || (ask === 'done' ? 'You marked this done' : 'You said this was not a real thing'))
            }}>{ask === 'done' ? 'Mark done' : 'Dismiss'}</button>
          </div>
        </div>
      )}
    </>
  )
}
