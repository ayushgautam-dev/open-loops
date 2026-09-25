import { useState, type ReactNode } from 'react'
import { Check, Clock, X } from 'lucide-react'
import { records, type LoopRow } from './lib'
import { useToast } from './ui'

/* Closing an item, with the context Lem cannot see.

   The writes here are the existing app's, unchanged: a close records when, how and by
   whom; a close with a person gets one line on their timeline; a dismissal is also a
   correction so Lem stops raising its like. Only the controls are new. */

type How = { label: string; reason: string; status: 'closed' | 'dropped' }
const DONE_HOW: How[] = [
  { label: 'Just done', reason: 'You marked this done', status: 'closed' },
  { label: 'On WhatsApp or a call', reason: 'Done off email (WhatsApp or a call)', status: 'closed' },
  { label: 'No longer needed', reason: 'No longer needed', status: 'closed' },
]

export async function closeLoop(loop: LoopRow, status: 'closed' | 'dropped' | 'parked', reason: string) {
  const now = new Date().toISOString()
  const patch = status === 'parked'
    ? { status, parked_until: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }
    : { status, closed_at: now, closed_by: 'manual', close_reason: reason }
  await records.update('loops', loop.id, patch)
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

/** A dismissal is a preference, not just a status: Lem reads `corrections` first. */
export async function rememberDismissal(loop: LoopRow, why: string) {
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

/** The one-move versions used from a row's hover and the J/K keys. */
export function useQuickClose() {
  const toast = useToast()
  return async (loop: LoopRow, what: 'done' | 'snooze' | 'dismiss', after: () => void) => {
    if (what === 'done') await closeLoop(loop, 'closed', 'You marked this done')
    if (what === 'snooze') await closeLoop(loop, 'parked', '')
    if (what === 'dismiss') { await closeLoop(loop, 'dropped', 'You said this was not a real thing'); await rememberDismissal(loop, '') }
    toast(what === 'snooze' ? 'Back in a week' : what === 'done' ? 'Marked done' : 'Dismissed',
      async () => { await reopenLoop(loop); after() })
    after()
  }
}

/** Done · Snooze · Dismiss, with the optional "how?" under Done and Dismiss. `lead` is
 *  whatever this item needs first (Send is inside the letter; here it is Nudge, Prepare). */
export function CloseBar({ loop, onClosed, lead }: {
  loop: LoopRow; onClosed: () => void; lead?: ReactNode
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
  const submitNote = () => {
    const n = note.trim()
    void finish(ask === 'done' ? 'closed' : 'dropped',
      n || (ask === 'done' ? 'You marked this done' : 'You said this was not a real thing'))
  }

  return (
    <div className="closebar">
      {ask && (
        <div className="how">
          <div className="how-q">{ask === 'done' ? 'How did it get done?' : 'Why isn’t this a thing?'}</div>
          {ask === 'done' && (
            <div className="how-chips">
              {DONE_HOW.map((h) => (
                <button key={h.label} className="chip-btn" disabled={busy} onClick={() => void finish(h.status, h.reason)}>{h.label}</button>
              ))}
            </div>
          )}
          <div className="how-note">
            <input
              autoFocus value={note}
              placeholder={ask === 'done' ? 'Or say what happened — “sent the deck on WhatsApp”' : 'Optional — Lem stops raising things like it'}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNote()
                if (e.key === 'Escape') { e.stopPropagation(); setAsk(null) }
              }}
            />
            <button className="btn ink sm" disabled={busy} onClick={submitNote}>{ask === 'done' ? 'Mark done' : 'Dismiss'}</button>
          </div>
        </div>
      )}
      <div className="closebar-row">
        <div className="closebar-lead">{lead}</div>
        <div className="seg-acts">
          <button className={ask === 'done' ? 'on' : ''} onClick={() => setAsk(ask === 'done' ? null : 'done')} title="Done (E)">
            <Check size={14} /> Done
          </button>
          <button onClick={() => void finish('parked', '')} title="Snooze a week (S)"><Clock size={14} /> Snooze</button>
          <button className={ask === 'drop' ? 'on' : ''} onClick={() => setAsk(ask === 'drop' ? null : 'drop')} title="Not a thing">
            <X size={14} /> Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
