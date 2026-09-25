import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, Download, Copy, ExternalLink, FileText, CalendarPlus, Send, Check, Video, Clock } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useSql, records, runFn, rev, lit, isGmailThread } from './lib'
import { Avatar, Markdown, Orb, useToast } from './ui'
import { useNav } from './nav'

/* What Lem prepared, drawn as the thing itself: a letter, an invitation, a document.
   You read it the way the other person will, change what you want, press one button.
   Every send is your click, held for a few seconds so it can be taken back.
   The send paths (`send_draft`, `send_invite`, `save_google_doc`) and the bookkeeping
   after a send are the existing app's, unchanged. */

export interface DraftRow {
  id: string
  loop_id?: string | null
  to_person_id?: string | null
  kind?: string | null
  subject?: string | null
  body?: string | null
  to_emails?: unknown
  cc_emails?: unknown
  meeting?: unknown
  note?: string | null
  status?: string | null
  person?: string | null
  person_email?: string | null
  avatar_url?: string | null
  thread_ref?: string | null
  obligation?: string | null
  [k: string]: unknown
}

export interface DocRow {
  id: string
  title: string
  body?: string | null
  doc_url?: string | null
  status?: string | null
  created_at?: string | null
  loop_id?: string | null
  [k: string]: unknown
}

interface Slot { start: string; end?: string }
interface Meeting { title?: string; duration_min?: number; attendees?: string[]; location?: string; slots?: Slot[] }

const DRAFT_SELECT = `
  select d.id, d.loop_id, d.to_person_id, d.kind, d.subject, d.body, d.to_emails, d.cc_emails,
         d.meeting, d.note, d.status, coalesce(p.name,'') as person, p.email as person_email,
         p.avatar_url, l.thread_ref, l.obligation
  from drafts d
  left join people p on p.id = d.to_person_id
  left join loops l on l.id = d.loop_id`

export const draftById = (id: string) => `${DRAFT_SELECT} where d.id = ${lit(id)} limit 1`
export const draftForLoop = (loopId: string) =>
  `${DRAFT_SELECT} where d.loop_id = ${lit(loopId)} and d.status = 'pending' order by d.created_at desc limit 1`

/* ---------------- small pieces ---------------- */

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string' && v.trim()) {
    try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(String) } catch { /* plain text */ }
    return v.split(/[,;\s]+/).filter((x) => x.includes('@'))
  }
  return []
}

export function asMeeting(v: unknown): Meeting | null {
  if (!v) return null
  if (typeof v === 'string') { try { return JSON.parse(v) as Meeting } catch { return null } }
  return v as Meeting
}

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())

function usePeopleByEmail(emails: string[]) {
  const key = emails.map((e) => e.toLowerCase()).sort().join(',')
  const q = useSql<{ email: string; name: string; avatar_url?: string | null }>(
    emails.length
      ? `select lower(email) as email, name, avatar_url from people
         where lower(email) in (${emails.map((e) => lit(e.toLowerCase())).join(',')})`
      : null)
  return useMemo(() => {
    const m = new Map<string, { name: string; avatar_url?: string | null }>()
    for (const r of q.items) m.set(r.email, { name: r.name, avatar_url: r.avatar_url })
    return m
  }, [q.items, key])
}

/** The line Lem writes above what it prepared. */
export function LemNote({ text }: { text?: string | null }) {
  if (!text) return null
  return (
    <div className="lemnote">
      <Orb size={14} />
      <span>{text}</span>
    </div>
  )
}

function Recipients({ label, emails, onChange }: {
  label: string; emails: string[]; onChange: (next: string[]) => void
}) {
  const people = usePeopleByEmail(emails)
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')
  const commit = () => {
    const v = val.trim().toLowerCase()
    if (isEmail(v) && !emails.includes(v)) onChange([...emails, v])
    setVal(''); setAdding(false)
  }
  return (
    <div className="rcpt">
      <span className="rcpt-k">{label}</span>
      <div className="rcpt-list">
        {emails.map((e) => {
          const p = people.get(e.toLowerCase())
          return (
            <span key={e} className="rcpt-chip" title={e}>
              <Avatar name={p?.name || e} src={p?.avatar_url} size="xs" />
              <span>{p?.name || e}</span>
              <button aria-label={`Remove ${e}`} onClick={() => onChange(emails.filter((x) => x !== e))}><X size={11} /></button>
            </span>
          )
        })}
        {adding ? (
          <input
            autoFocus className="rcpt-in" value={val} placeholder="name@company.com"
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() } if (e.key === 'Escape') { e.stopPropagation(); setVal(''); setAdding(false) } }}
          />
        ) : (
          <button className="rcpt-add" onClick={() => setAdding(true)} aria-label={`Add ${label}`}><Plus size={12} /></button>
        )}
      </div>
    </div>
  )
}

/** Hold a send for a few seconds so it can be taken back. Nothing has left until the count ends.
 *  The send fires from the interval itself, never a state updater (StrictMode replays those). */
function useHeldSend(seconds = 6) {
  const [left, setLeft] = useState<number | null>(null)
  const timer = useRef<number | null>(null)
  const action = useRef<(() => Promise<void>) | null>(null)
  const count = useRef(0)
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])
  function start(run: () => Promise<void>) {
    if (timer.current) return
    action.current = run
    count.current = seconds
    setLeft(seconds)
    timer.current = window.setInterval(() => {
      count.current -= 1
      if (count.current > 0) { setLeft(count.current); return }
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
      setLeft(null)
      const go = action.current
      action.current = null
      if (go) void go()
    }, 1000)
  }
  function cancel() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null; action.current = null; setLeft(null)
  }
  return { left, start, cancel, seconds }
}

function HeldButton({ held, label, icon, disabled, onGo }: {
  held: ReturnType<typeof useHeldSend>; label: string; icon: React.ReactNode; disabled?: boolean; onGo: () => void
}) {
  if (held.left !== null) {
    return (
      <button className="send held" onClick={held.cancel} style={{ ['--p' as string]: `${(held.left / held.seconds) * 100}%` }}>
        <span className="held-bar" /> Sending in {held.left}s · <b>Undo</b>
      </button>
    )
  }
  return <button className="send" disabled={disabled} onClick={onGo}>{icon} {label}</button>
}

async function closeAfterSend(d: DraftRow, how: string) {
  const now = new Date().toISOString()
  await records.update('drafts', d.id, { status: 'sent', subject: d.subject ?? '', body: d.body ?? '' })
  if (d.loop_id) {
    await records.update('loops', d.loop_id, {
      status: 'closed', closed_at: now, closed_by: 'manual', close_reason: how,
    })
  }
  if (d.to_person_id) {
    try {
      await records.create('timeline_events', {
        person_id: d.to_person_id, type: 'email', source: 'email', title: how, happened_at: now,
        ref: d.thread_ref || null,
      })
    } catch { /* the send is what matters */ }
  }
}

/* ---------------- a letter ---------------- */

function docAsHtml(d: DocRow): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const inner = renderToStaticMarkup(<Markdown text={d.body ?? ''} />)
  const link = d.doc_url ? `<p><a href="${esc(d.doc_url)}">Open in Google Docs</a></p>` : ''
  return `<p style="color:#777;font-size:12px;letter-spacing:.04em;text-transform:uppercase;margin:0 0 6px">Attached</p>`
    + `<h2 style="font-size:18px;margin:0 0 12px">${esc(d.title)}</h2>${link}${inner}`
}

export function Letter({ draft, onSent, docs = [] }: { draft: DraftRow; onSent?: () => void; docs?: DocRow[] }) {
  const toast = useToast()
  const { bump } = useNav()
  const initialTo = asList(draft.to_emails)
  const [to, setTo] = useState<string[]>(initialTo.length ? initialTo : draft.person_email ? [draft.person_email] : [])
  const [cc, setCc] = useState<string[]>(asList(draft.cc_emails))
  const [showCc, setShowCc] = useState(asList(draft.cc_emails).length > 0)
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body ?? '')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>(draft.status === 'sent' ? 'sent' : 'idle')
  const held = useHeldSend()
  const [attach, setAttach] = useState<string[]>(docs.map((d) => d.id))
  useEffect(() => { setAttach(docs.map((d) => d.id)) }, [docs.map((d) => d.id).join(',')])
  const area = useRef<HTMLTextAreaElement>(null)
  const isReply = isGmailThread(draft.thread_ref)
  const who = draft.person || to[0] || ''

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 160)}px`
  }, [body])

  async function reallySend() {
    setState('sending')
    try {
      const out = await runFn<{ sent?: boolean; error?: string; mode?: string }>('send_draft', {
        draft_id: draft.id, subject, body,
        to_email: to[0], extra_to: to.slice(1), cc, thread_ref: draft.thread_ref ?? '',
        to_name: draft.person ?? '',
        appendix_html: docs.filter((d) => attach.includes(d.id)).map(docAsHtml).join('<hr style="margin:24px 0">') || null,
      })
      if (!out?.sent) {
        setState('idle')
        toast(out?.error ? `Not sent — ${out.error}` : 'Not sent — Gmail refused it')
        return
      }
      await closeAfterSend({ ...draft, subject, body },
        `You ${out.mode === 'reply' ? 'replied to' : 'wrote to'} ${draft.person || to[0]}`)
      setState('sent')
      toast(out.mode === 'reply' ? `Replied to ${draft.person || to[0]}` : `Sent to ${draft.person || to[0]}`)
      bump(); onSent?.()
    } catch (e) {
      setState('idle')
      toast(`Not sent — ${(e as Error)?.message ?? 'something went wrong'}`)
    }
  }

  async function discard() {
    await records.update('drafts', draft.id, { status: 'skipped' })
    toast('Draft discarded', async () => { await records.update('drafts', draft.id, { status: 'pending' }); bump() })
    bump()
  }

  if (state === 'sent') {
    return <div className="letter sent"><Check size={15} /> Sent to {who}</div>
  }

  return (
    <div className="letter">
      <div className="letter-head">
        <span className="letter-k">{isReply ? 'Reply' : 'New email'}</span>
        {!showCc && <button className="link-q" onClick={() => setShowCc(true)}>Cc</button>}
      </div>
      <Recipients label="To" emails={to} onChange={setTo} />
      {showCc && <Recipients label="Cc" emails={cc} onChange={setCc} />}
      {isReply
        ? (subject ? <div className="letter-subj ro">{subject}</div> : null)
        : <input className="letter-subj" value={subject} placeholder="Subject" onChange={(e) => setSubject(e.target.value)} />}
      <textarea ref={area} className="letter-body" value={body} onChange={(e) => setBody(e.target.value)} />
      {docs.length > 0 && (
        <div className="attach-row">
          {docs.map((d) => attach.includes(d.id) ? (
            <span key={d.id} className="attach" title="Goes out inside the email, below your note">
              <FileText size={12} /> {d.title}
              <button aria-label="Don't include" onClick={() => setAttach((a) => a.filter((x) => x !== d.id))}><X size={11} /></button>
            </span>
          ) : (
            <button key={d.id} className="link-q" onClick={() => setAttach((a) => [...a, d.id])}>+ Include {d.title}</button>
          ))}
        </div>
      )}
      <div className="letter-foot">
        <button className="link-q" onClick={() => void discard()}>Discard</button>
        <span className="grow" />
        <HeldButton held={held} disabled={state === 'sending' || !to.length || !body.trim()}
          icon={<Send size={13} />} label={state === 'sending' ? 'Sending…' : isReply ? `Send reply` : 'Send'}
          onGo={() => held.start(reallySend)} />
      </div>
    </div>
  )
}

/* ---------------- an invitation ---------------- */

function slotParts(s: Slot, dur: number) {
  const a = new Date(s.start)
  const b = s.end ? new Date(s.end) : new Date(a.getTime() + dur * 60000)
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return {
    dow: a.toLocaleDateString(undefined, { weekday: 'short' }),
    date: a.getDate(),
    mon: a.toLocaleDateString(undefined, { month: 'short' }),
    day: a.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    time: `${t(a)} – ${t(b)}`,
  }
}

function localStamp(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Invitation({ draft, onSent }: { draft: DraftRow; onSent?: () => void }) {
  const toast = useToast()
  const { bump } = useNav()
  const m = asMeeting(draft.meeting) ?? {}
  const dur = Number(m.duration_min) || 30
  const slots = (m.slots ?? []).filter((s) => s?.start && !Number.isNaN(Date.parse(s.start)))
  const [pick, setPick] = useState(0)
  const [guests, setGuests] = useState<string[]>(
    asList(m.attendees).length ? asList(m.attendees) : draft.person_email ? [draft.person_email] : [])
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>(draft.status === 'sent' ? 'sent' : 'idle')
  const held = useHeldSend()
  const title = m.title || draft.subject || 'Meeting'

  async function reallySend() {
    const s = slots[pick]
    if (!s) return
    setState('sending')
    try {
      const out = await runFn<{ sent?: boolean; error?: string; link?: string }>('send_invite', {
        title, start: localStamp(s.start), duration_min: dur,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        attendees: guests, description: draft.body ?? '',
      })
      if (!out?.sent) {
        setState('idle')
        toast(out?.error ? `Invite not sent — ${out.error}` : 'Invite not sent')
        return
      }
      const when = slotParts(s, dur)
      await closeAfterSend(draft, `Invite sent for ${when.day}, ${when.time}`)
      setState('sent')
      toast(`Invite sent — ${when.day}, ${when.time}`)
      bump(); onSent?.()
    } catch (e) {
      setState('idle')
      toast(`Invite not sent — ${(e as Error)?.message ?? 'something went wrong'}`)
    }
  }

  if (state === 'sent') return <div className="letter sent"><Check size={15} /> Invite sent</div>

  return (
    <div className="letter invite">
      <div className="letter-head"><span className="letter-k">Invitation</span></div>
      <div className="inv-title">{title}</div>
      <div className="inv-meta">
        <span><Clock size={12} /> {dur} min</span>
        <span><Video size={12} /> {m.location || 'Google Meet'}</span>
      </div>
      {slots.length === 0
        ? <p className="muted" style={{ margin: '10px 0' }}>No free times found — ask Lem for more.</p>
        : (
          <div className="slots" role="radiogroup">
            {slots.map((s, i) => {
              const p = slotParts(s, dur)
              return (
                <button key={i} role="radio" aria-checked={pick === i}
                  className={`slot${pick === i ? ' on' : ''}`} onClick={() => setPick(i)}>
                  <span className="slot-cal"><small>{p.dow}</small><b>{p.date}</b><small>{p.mon}</small></span>
                  <span className="slot-t">{p.time}</span>
                </button>
              )
            })}
          </div>
        )}
      <Recipients label="Guests" emails={guests} onChange={setGuests} />
      <div className="letter-foot">
        <span className="grow" />
        <HeldButton held={held} disabled={!slots.length || !guests.length || state === 'sending'}
          icon={<CalendarPlus size={13} />} label={state === 'sending' ? 'Sending…' : 'Send invite'}
          onGo={() => held.start(reallySend)} />
      </div>
    </div>
  )
}

/* ---------------- a document ---------------- */

function download(name: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function asWordHtml(title: string, el: HTMLElement | null) {
  const inner = el?.innerHTML ?? ''
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45}h1{font-size:18pt}h2{font-size:14pt}h3{font-size:12pt}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}</style>
</head><body><h1>${title.replace(/</g, '&lt;')}</h1>${inner}</body></html>`
}

/** `reader` is the full-height reading view; otherwise a folded preview card. */
export function Paper({ doc, reader }: { doc: DocRow; reader?: boolean }) {
  const toast = useToast()
  const { push, bump } = useNav()
  const [open, setOpen] = useState(!!reader)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState(doc.doc_url ?? '')
  const bodyRef = useRef<HTMLDivElement>(null)
  // a document that repeats its own title as its first heading reads it twice
  const body = String(doc.body ?? '').replace(/^\s*#\s+(.+)\n+/, (m, h: string) =>
    h.trim().toLowerCase() === (doc.title || '').trim().toLowerCase() ? '' : m)
  const safeName = (doc.title || 'document').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'document'

  async function toGoogle() {
    if (url) { window.open(url, '_blank', 'noopener'); return }
    const win = window.open('', '_blank')
    setBusy(true)
    try {
      const out = await runFn<{ saved?: boolean; url?: string; needs_connect?: boolean; error?: string }>(
        'save_google_doc', { title: doc.title, markdown: doc.body ?? '' })
      if (out?.saved && out.url) {
        setUrl(out.url)
        await records.update('deliverables', doc.id, { doc_url: out.url })
        bump()
        if (win) win.location.href = out.url
        return
      }
      if (out?.needs_connect) {
        const c = await runFn<{ authorization_url?: string }>('connect_source', { app: 'google_docs' })
        if (c?.authorization_url && win) { win.location.href = c.authorization_url; toast('Connect Google Docs, then press Open again') }
        else { win?.close(); toast('Google Docs is connected — press Open again') }
        return
      }
      win?.close()
      toast(out?.error || 'Could not create the Google Doc')
    } catch (e) {
      win?.close()
      toast((e as Error)?.message || 'Could not create the Google Doc')
    } finally { setBusy(false) }
  }

  const tools = (
    <div className="paper-tools">
      <button className="btn line sm" disabled={busy} onClick={() => void toGoogle()}>
        <ExternalLink size={12} /> {busy ? 'Opening…' : 'Google Docs'}
      </button>
      <button className="icon-btn" title="Download for Word"
        onClick={() => download(`${safeName}.doc`, 'application/msword', asWordHtml(doc.title, bodyRef.current))}>
        <Download size={14} />
      </button>
      <button className="icon-btn" title="Copy as markdown" onClick={() => { void navigator.clipboard.writeText(doc.body ?? ''); toast('Copied') }}>
        <Copy size={14} />
      </button>
      <button className="icon-btn" title="Download .md" onClick={() => download(`${safeName}.md`, 'text/markdown', `# ${doc.title}\n\n${doc.body ?? ''}`)}>
        <FileText size={14} />
      </button>
    </div>
  )

  if (reader) {
    return (
      <article className="reader">
        <div className="reader-top">{tools}</div>
        <h1 className="reader-title">{doc.title}</h1>
        <div ref={bodyRef} className="reader-body"><Markdown text={body} /></div>
      </article>
    )
  }
  return (
    <div className="paper">
      <div className="paper-head">
        <span className="paper-k"><FileText size={13} /> Document</span>
        {tools}
      </div>
      <div className="paper-title">{doc.title}</div>
      <div ref={bodyRef} className={`paper-body${open ? ' open' : ''}`}><Markdown text={body} /></div>
      <div className="letter-foot">
        <button className="link-q" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Read all'}</button>
        <span className="grow" />
        <button className="link-q" onClick={() => push({ type: 'doc', id: doc.id })}>Open as a page →</button>
      </div>
    </div>
  )
}

/* ---------------- pick the right shape ---------------- */

export function Prepared({ draft, onSent, docs }: { draft: DraftRow; onSent?: () => void; docs?: DocRow[] }) {
  if ((draft.kind ?? '') === 'meeting' && asMeeting(draft.meeting)?.slots?.length) {
    return <Invitation draft={draft} onSent={onSent} />
  }
  return <Letter draft={draft} onSent={onSent} docs={docs} />
}

/** Referenced from chat by id (`[[draft:…]]` / `[[doc:…]]`): a chip that opens the real
 *  thing in Focus, never pasted into the conversation. */
export function WorkChip({ kind, id }: { kind: 'draft' | 'doc'; id: string }) {
  const { version, open } = useNav()
  const d = useSql<DraftRow>(rev(kind === 'draft' ? draftById(id) : null, version))
  const doc = useSql<DocRow>(rev(kind === 'doc'
    ? `select id, title, status, loop_id from deliverables where id=${lit(id)} limit 1`
    : null, version))
  if (kind === 'draft') {
    const row = d.items[0]
    if (!row) return null
    const first = (row.person || '').split(' ')[0]
    const meeting = row.kind === 'meeting'
    return (
      <button className="workchip" onClick={() => row.loop_id && open({ type: 'loop', id: row.loop_id })}>
        <span className="workchip-ic">{meeting ? <CalendarPlus size={14} /> : <Send size={14} />}</span>
        <span className="workchip-t">
          <b>{meeting ? `Proposed times${first ? ` with ${first}` : ''}` : `Email to ${first || 'them'}`}</b>
          {row.subject && <small>{row.subject}</small>}
        </span>
        <span className="workchip-s">{row.status === 'sent' ? 'Sent' : 'Review →'}</span>
      </button>
    )
  }
  const row = doc.items[0]
  if (!row) return null
  return (
    <button className="workchip" onClick={() => open({ type: 'doc', id: row.id })}>
      <span className="workchip-ic"><FileText size={14} /></span>
      <span className="workchip-t"><b>{row.title}</b><small>Document</small></span>
      <span className="workchip-s">Read →</span>
    </button>
  )
}

export function useDocsForLoop(loopId: string | null) {
  const { version } = useNav()
  return useSql<DocRow>(rev(loopId
    ? `select id, title, body, doc_url, status, created_at, loop_id from deliverables
       where loop_id=${lit(loopId)} and status <> 'discarded' order by created_at desc limit 3`
    : null, version))
}
