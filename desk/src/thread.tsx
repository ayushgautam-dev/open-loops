import { useEffect, useState } from 'react'
import { ExternalLink, Paperclip, ChevronDown } from 'lucide-react'
import { runFn } from './lib'
import { Avatar } from './ui'

/* The email conversation behind an item, fetched through `get_email_thread` exactly as
   before. Loaded as soon as the item opens, shown folded: the last two messages open,
   earlier ones as one line each. */

interface Att { filename: string; mime: string; attachment_id: string }
interface ThreadMsg { id: string; from_name: string; from_email: string; date: string; body: string; mine: boolean; subject?: string; attachments?: Att[] }
const cache = new Map<string, { subject: string; messages: ThreadMsg[] }>()

export function Conversation({ threadRef }: { threadRef: string }) {
  const [data, setData] = useState(cache.get(threadRef) ?? null)
  const [err, setErr] = useState('')
  const [openIds, setOpenIds] = useState<Set<string> | null>(null)
  const [fetching, setFetching] = useState<string | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let live = true
    if (cache.has(threadRef)) { setData(cache.get(threadRef)!); return }
    runFn<{ subject?: string; messages?: ThreadMsg[]; error?: string }>('get_email_thread', { thread_id: threadRef })
      .then((out) => {
        if (!live) return
        if (out.error && !out.messages?.length) { setErr(out.error); return }
        const d = { subject: out.subject ?? '', messages: out.messages ?? [] }
        cache.set(threadRef, d); setData(d)
      })
      .catch((e) => { if (live) setErr((e as Error)?.message || 'Could not open the conversation') })
    return () => { live = false }
  }, [threadRef])

  const total = data?.messages.length ?? 0
  const files = data?.messages.reduce((n, m) => n + (m.attachments?.length ?? 0), 0) ?? 0
  const last = data?.messages[data.messages.length - 1]

  async function openAttachment(m: ThreadMsg, a: Att) {
    setFetching(a.attachment_id)
    const win = window.open('', '_blank')   // opened on the click; one opened after an await is blocked
    try {
      const out = await runFn<{ content_base64?: string; mime?: string; error?: string }>('get_email_attachment', {
        message_id: m.id, attachment_id: a.attachment_id, file_name: a.filename })
      if (!out.content_base64) { win?.close(); setErr(out.error || 'Could not open the attachment'); return }
      const bytes = Uint8Array.from(atob(out.content_base64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: a.mime || out.mime || 'application/octet-stream' }))
      if (win) win.location.href = url
      else { const l = document.createElement('a'); l.href = url; l.download = a.filename; l.click() }
    } catch (e) { win?.close(); setErr((e as Error)?.message || 'Could not open the attachment') }
    finally { setFetching(null) }
  }

  return (
    <section className={`convo${shown ? ' shown' : ''}`}>
      <button className="convo-bar" onClick={() => setShown((v) => !v)} disabled={!data && !err}>
        <span className="convo-mark">M</span>
        <span className="convo-l">
          <b>{data?.subject || 'The conversation'}</b>
          <small>
            {data
              ? `${total} message${total === 1 ? '' : 's'}${files ? ` · ${files} attachment${files === 1 ? '' : 's'}` : ''}${last ? ` · last from ${last.mine ? 'you' : last.from_name.split(' ')[0]}` : ''}`
              : err ? 'Could not load' : 'Loading…'}
          </small>
        </span>
        <ChevronDown size={15} className="convo-chev" />
      </button>

      {shown && err && <p className="muted" style={{ padding: '4px 14px 12px' }}>{err}</p>}
      {shown && data && (() => {
        const msgs = data.messages
        const opened = openIds ?? new Set(msgs.slice(-2).map((m) => m.id))
        const toggle = (id: string) => setOpenIds(() => {
          const n = new Set(opened); if (n.has(id)) n.delete(id); else n.add(id); return n
        })
        return (
          <div className="convo-msgs">
            {msgs.map((m) => {
              const open = opened.has(m.id)
              const d = new Date(m.date)
              const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
              return (
                <div key={m.id} className={`msg-m${open ? ' open' : ''}${m.mine ? ' mine' : ''}`}>
                  <div className="msg-h" onClick={() => toggle(m.id)}>
                    <Avatar name={m.mine ? 'You' : m.from_name} size="xs" />
                    <span className="msg-from">{m.mine ? 'You' : m.from_name}</span>
                    {!open && !!m.attachments?.length && <Paperclip size={11} className="muted" />}
                    <span className="msg-when">{when}</span>
                  </div>
                  <div className="msg-b" onClick={() => !open && toggle(m.id)}>
                    {open ? m.body : m.body.replace(/\s+/g, ' ').slice(0, 120)}
                  </div>
                  {open && !!m.attachments?.length && (
                    <div className="msg-atts">
                      {m.attachments.map((a) => (
                        <button key={a.attachment_id} className="attach" disabled={fetching === a.attachment_id}
                          onClick={() => void openAttachment(m, a)}>
                          <Paperclip size={12} /> {fetching === a.attachment_id ? 'Opening…' : a.filename}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <a className="convo-gmail" href={`https://mail.google.com/mail/u/0/#all/${threadRef}`} target="_blank" rel="noreferrer">
              Open in Gmail <ExternalLink size={11} />
            </a>
          </div>
        )
      })()}
    </section>
  )
}
