import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useConversationMessages } from 'lemma-sdk/react'
import { ArrowUp, Square } from 'lucide-react'
import { client, sql, lit, records } from './lib'
import { Markdown } from './ui'
import { CardById } from './cards'

/* Lem is the only thing anyone talks to. One conversation per scope, remembered
   in the pod (not localStorage) so reopening the panel resumes the same thread.

   What changed on 23 Sep, from reading real conversations:
   - A turn often runs 30–60s and dozens of tool calls. Three dots and a rotating
     "Still going…" read as broken. Lem's own tool calls say what it is doing, so the
     panel shows those, in words, while it works — and folds them away after.
   - Drafts and documents render as cards (`[[draft:id]]`, `[[doc:id]]`), never as a
     wall of pasted text.
   - The work can be stopped. */

type Msg = {
  id?: string; role?: string; kind?: string; text?: string; content?: string
  tool_name?: string; tool_args?: Record<string, unknown> | null; created_at?: string
}

function textOf(m: Msg): string | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null
  const kind = (m.kind ?? 'text').toLowerCase()
  if (kind !== 'text' && kind !== 'message') return null
  const t = (typeof m.text === 'string' ? m.text : typeof m.content === 'string' ? m.content : '').trim()
  return t || null
}

/** What Lem is doing, in a handful of plain phrases. Lem's own tool comments are
 *  written for engineers ("Inspect sync_granola signature"), so they are never shown;
 *  each call is sorted into one of these instead, or left out. */
function stepLabel(m: Msg): string | null {
  if ((m.kind ?? '').toUpperCase() !== 'TOOL_CALL') return null
  const name = (m.tool_name ?? '').toLowerCase()
  const a = (m.tool_args ?? {}) as Record<string, unknown>
  const blob = `${name} ${String(a.sql ?? '')} ${String(a.path ?? '')} ${String(a.cmd ?? '')}`.toLowerCase()
  if (/load_skill|list_skills|agents\.md/.test(blob)) return null
  if (/insert into drafts|drafts.*(create|update)|deliverables.*(create|insert)|voice\.md/.test(blob)) return 'Writing it'
  if (/granola|meeting/.test(blob)) return 'Reading your meeting notes'
  if (/calendar|free_slots|slot/.test(blob)) return 'Checking your calendar'
  if (/gmail|interactions|\/people\/|thread/.test(blob)) return 'Reading your mail'
  if (/search|web|research/.test(blob)) return 'Looking it up'
  return 'Working on it'
}

interface Turn { user?: string; steps: string[]; replies: string[] }

function toTurns(msgs: Msg[]): Turn[] {
  const out: Turn[] = []
  let cur: Turn | null = null
  for (const m of msgs) {
    const t = textOf(m)
    if (m.role === 'user' && t) {
      // the panel's own scaffolding is not something the person said
      cur = { user: t.replace(/\n\n\(This is task [\s\S]*$/, ''), steps: [], replies: [] }
      out.push(cur)
      continue
    }
    if (!cur) { cur = { steps: [], replies: [] }; out.push(cur) }
    const s = stepLabel(m)
    if (s && cur.steps[cur.steps.length - 1] !== s) cur.steps.push(s)
    if (m.role === 'assistant' && t) cur.replies.push(t)
  }
  // Lem often talks while it works ("I'll start by loading…", "Found it, now fixing…").
  // Those are progress, not answers: a finished turn shows only its last reply.
  for (const t of out) if (t.replies.length > 1) t.replies = [t.replies[t.replies.length - 1]]
  return out
}

/** Lem's text with `[[draft:id]]` / `[[doc:id]]` markers turned into the cards. */
function Reply({ text }: { text: string }) {
  const parts = useMemo(() => {
    const re = /\[\[(draft|doc):([0-9a-f-]{36})\]\]/gi
    const out: ({ t: string } | { kind: 'draft' | 'doc'; id: string })[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) })
      out.push({ kind: m[1].toLowerCase() as 'draft' | 'doc', id: m[2] })
      last = m.index + m[0].length
    }
    if (last < text.length) out.push({ t: text.slice(last) })
    return out
  }, [text])
  return (
    <>
      {parts.map((p, i) => ('t' in p
        ? (p.t.trim() ? <Markdown key={i} text={p.t} /> : null)
        : <div key={i} className="chat-card"><CardById kind={p.kind} id={p.id} /></div>))}
    </>
  )
}

/** One quiet line while Lem works; nothing once it has answered. */
function Steps({ steps, live }: { steps: string[]; live: boolean }) {
  if (!live) return null
  const now = steps[steps.length - 1] ?? 'Working on it'
  return (
    <div className="steps live">
      <div className="steps-h"><span className="pulse" /> {now}…</div>
    </div>
  )
}

async function rememberedConversation(scopeKey: string): Promise<string | null> {
  try {
    const rows = await sql<{ conversation_id: string }>(
      `select conversation_id from chat_threads where scope_key=${lit(scopeKey)}
       order by last_used_at desc limit 1`,
    )
    return rows[0]?.conversation_id ?? null
  } catch { return null }
}

async function remember(scopeKey: string, conversationId: string, title: string) {
  try {
    const rows = await sql<{ id: string }>(
      `select id from chat_threads where scope_key=${lit(scopeKey)} limit 1`,
    )
    const patch = { conversation_id: conversationId, title, last_used_at: new Date().toISOString() }
    if (rows[0]) await records.update('chat_threads', rows[0].id, patch)
    else await records.create('chat_threads', { scope_key: scopeKey, ...patch })
  } catch { /* the conversation still works without the bookmark */ }
}

export interface ChatScope {
  key: string
  /** One sentence telling Lem what this conversation is about. */
  about: string
  title: string
}

const STARTERS = [
  'What needs me today?',
  'Prepare everything I owe people this week',
  'What did I promise on my last call?',
]

export function Chat({ scope, placeholder = 'Ask Lem…', seed, starters = STARTERS, onSeedSent }: {
  scope: ChatScope; placeholder?: string; seed?: string; starters?: string[]; onSeedSent?: () => void
}) {
  const [convId, setConvId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [booting, setBooting] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let live = true
    setBooting(true); setConvId(null)
    rememberedConversation(scope.key)
      .then((id) => { if (live) { setConvId(id); setBooting(false) } })
      .catch(() => { if (live) setBooting(false) })
    return () => { live = false }
  }, [scope.key])

  useEffect(() => { if (!booting) inputRef.current?.focus() }, [booting, scope.key])

  const instructions = useMemo(
    () => `You are talking to the person inside Open Loops.\nCONTEXT: ${scope.about}\n`
        + `Answer in one or two sentences unless they ask for more; at most four short bullets. `
        + `Never mention workflows, schedules, functions, tables or ids. `
        + `When you prepare an email, meeting or document, end with its [[draft:id]] or [[doc:id]] marker — never paste it.`,
    [scope.about],
  )

  const thread = useConversationMessages({
    client, agentName: 'pod_default', conversationId: convId,
    instructions, autoResume: true,
  })
  const running = thread.isStreaming || thread.isRunning

  // A message typed on the Feed opens this panel already carrying it.
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!seed || booting || seededRef.current === seed) return
    seededRef.current = seed
    onSeedSent?.()
    void (async () => {
      try {
        const id = await ensureConversation(seed)
        await thread.sendMessage(seed, { conversationId: id })
      } catch (err) {
        console.error('Lem could not take that message', err)
      }
    })()
  }, [seed, booting])

  const turns = toTurns(thread.messages as Msg[])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, thread.streamingText, turns[turns.length - 1]?.steps.length])

  /** The hook will not open a conversation for us, so we do it here and hand the
   *  id straight to sendMessage — waiting for state to settle would drop the turn. */
  async function ensureConversation(firstText: string): Promise<string> {
    if (convId) { void remember(scope.key, convId, scope.title); return convId }
    const c = await client.conversations.createForAgent('pod_default') as { id: string }
    setConvId(c.id)
    const title = scope.key.startsWith('home') ? firstText.slice(0, 60) : scope.title
    void remember(scope.key, c.id, title)
    return c.id
  }

  async function send(text = draft.trim()) {
    if (!text || running) return
    setDraft('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    try {
      const id = await ensureConversation(text)
      await thread.sendMessage(text, { conversationId: id })
    } catch (err) {
      console.error('Lem could not take that message', err)
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {thread.hasOlderMessages && (
          <button className="link-q" style={{ alignSelf: 'center' }} disabled={thread.isLoadingOlder}
            onClick={() => void thread.loadOlder()}>
            {thread.isLoadingOlder ? 'Loading…' : 'Earlier messages'}
          </button>
        )}
        {!booting && turns.length === 0 && !running && (
          <div className="chat-empty">
            <div className="chat-empty-h">What can I take off your plate?</div>
            <div className="starters">
              {starters.map((s) => (
                <button key={s} className="starter" onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => {
          const last = i === turns.length - 1
          const live = last && running
          return (
            <Fragment key={i}>
              {t.user && (
                <div className="msg me"><div className="bubble">{t.user}</div></div>
              )}
              <div className="msg lem">
                <Steps steps={t.steps} live={live} />
                {!live && t.replies.map((r, j) => <div key={j} className="lem-text"><Reply text={r} /></div>)}
              </div>
            </Fragment>
          )
        })}

        {running && turns.length === 0 && (
          <div className="msg lem"><Steps steps={[]} live /></div>
        )}
        {thread.error && !running && (
          <div className="chat-err">Lem stopped before finishing. Send it again, or ask it differently.</div>
        )}
      </div>

      <div className="chat-foot">
        <div className="ask" style={{ margin: 0, boxShadow: 'none' }}>
          <textarea
            ref={inputRef}
            value={draft}
            placeholder={placeholder}
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 190)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
            }}
          />
          <div className="ask-bar">
            <span className="hint">{running ? 'Lem is working — you can close this, it keeps going' : ''}</span>
            {running ? (
              <button className="send-btn" onClick={() => void thread.stop(convId)} title="Stop">
                <Square size={10} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" disabled={!draft.trim()} onClick={() => void send()} title="Send">
                <ArrowUp size={14} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
