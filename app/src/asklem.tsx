import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { Plus, ChevronDown, X } from 'lucide-react'
import { Chat, type ChatScope } from './chat'
import { useSql, rev, ageLabel, lit } from './lib'
import { useNav, type SheetTarget } from './nav'

/* Lem lives in the right-hand workspace as a tab, beside whatever else is open there.
   The rail and ⌘J open it onto the last conversation without sending anything; every
   earlier conversation is one click away in the title menu. */

type Ask = (seed: string, scope?: Partial<ChatScope>) => void
interface Panel { ask: Ask; open: (scope?: Partial<ChatScope>) => void; close: () => void; isOpen: boolean }

const Ctx = createContext<Panel>({ ask: () => {}, open: () => {}, close: () => {}, isOpen: false })
export const useAskLem = () => useContext(Ctx).ask
export const useLemPanel = () => useContext(Ctx)

export const HOME: ChatScope = {
  key: 'home',
  about: 'the whole workspace — their people, commitments and workstreams',
  title: 'Lem',
}

interface ThreadRow { scope_key: string; title: string; last_used_at: string; [k: string]: unknown }

function scopeFor(t: ThreadRow): ChatScope {
  const k = t.scope_key
  if (k.startsWith('person:')) return { key: k, title: t.title, about: `${t.title.replace(/^About /, '')} (person_id ${k.slice(7)})` }
  if (k.startsWith('company:')) return { key: k, title: t.title, about: `${t.title.replace(/^About /, '')} (company_id ${k.slice(8)})` }
  if (k.startsWith('loop:')) return { key: k, title: t.title, about: `the commitment "${t.title}" (loop_id ${k.slice(5)})` }
  return { ...HOME, key: k, title: t.title || 'Lem' }
}

const niceTitle = (t: string) => (t === 'Work this loop' ? 'A commitment' : t || 'Conversation')

function Threads({ current, onPick }: { current: string; onPick: (s: ChatScope) => void }) {
  const { version } = useNav()
  const q = useSql<ThreadRow>(rev(
    `select c.scope_key,
            case when c.scope_key like 'loop:%' and l.obligation is not null then l.obligation
                 else coalesce(c.title,'') end as title,
            c.last_used_at
     from chat_threads c
     left join loops l on c.scope_key = 'loop:' || l.id::text
     order by c.last_used_at desc nulls last limit 30`, version))
  return (
    <div className="threads">
      {q.items.length === 0 && <div className="empty" style={{ padding: 12, fontSize: 13 }}>No conversations yet.</div>}
      {q.items.map((t) => (
        <button key={t.scope_key} className={`thread${t.scope_key === current ? ' on' : ''}`} onClick={() => onPick(scopeFor(t))}>
          <span className="thread-t">{niceTitle(t.title)}</span>
          <span className="thread-w">{ageLabel(t.last_used_at)}</span>
        </button>
      ))}
    </div>
  )
}

/** The thing open beside Lem, so a question like "what does he still owe me?" needs no
 *  explaining. Attached automatically; one click removes it. */
function useContextTab() {
  const { tabs } = useNav()
  const t = [...tabs].reverse().find((x) => x.type !== 'lem') as
    Exclude<SheetTarget, { type: 'lem' }> | undefined
  const q = useSql<{ label: string }>(t
    ? t.type === 'person' ? `select name as label from people where id=${lit(t.id)}`
      : t.type === 'company' ? `select name as label from companies where id=${lit(t.id)}`
        : t.type === 'doc' ? `select title as label from deliverables where id=${lit(t.id)}`
          : t.type === 'workstream' ? `select title as label from work_projects where id=${lit(t.id)}`
            : `select obligation as label from loops where id=${lit(t.id)}`
    : null)
  if (!t) return null
  const label = q.items[0]?.label ?? ''
  const what = t.type === 'loop' ? `the commitment "${label}" (loop_id ${t.id})`
    : t.type === 'doc' ? `the document "${label}" (deliverables id ${t.id})`
      : `${label} (${t.type}_id ${t.id})`
  return { key: `${t.type}:${t.id}`, label, what }
}

export function LemPane({ tab }: { tab: Extract<SheetTarget, { type: 'lem' }> }) {
  const { openSheet } = useNav()
  const [listOpen, setListOpen] = useState(false)
  const ctx = useContextTab()
  const [dropped, setDropped] = useState<string | null>(null)
  const useCtx = ctx && ctx.label && dropped !== ctx.key
  const base = tab.about ?? HOME.about
  const scope: ChatScope = {
    key: tab.key ?? HOME.key, title: tab.title ?? HOME.title,
    about: useCtx ? `${base}. Right now they have ${ctx!.what} open in their workspace — assume questions are about it unless they say otherwise.` : base,
  }
  const pick = (s: ChatScope) => { setListOpen(false); openSheet({ type: 'lem', key: s.key, title: s.title, about: s.about }) }
  return (
    <div className="pane-body flush">
      <div className="lem-sub">
        <button className="lem-title" onClick={() => setListOpen((v) => !v)} title="Your conversations">
          <span className="lem-t">{niceTitle(scope.title)}</span>
          <ChevronDown size={13} style={{ transform: listOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        <button className="btn quiet" title="New conversation"
          onClick={() => pick({ ...HOME, key: `home:${Date.now()}`, title: 'New conversation' })}>
          <Plus size={15} />
        </button>
      </div>
      {useCtx && !listOpen && (
        <div className="ctx-row">
          <span className="ctx-chip" title="Lem will read this as the context for your question">
            {ctx!.label.length > 48 ? `${ctx!.label.slice(0, 48)}…` : ctx!.label}
            <button aria-label="Remove context" onClick={() => setDropped(ctx!.key)}><X size={11} /></button>
          </span>
        </div>
      )}
      {listOpen
        ? <Threads current={scope.key} onPick={pick} />
        : <Chat key={scope.key} scope={scope} seed={tab.seed}
            onSeedSent={() => openSheet({ ...tab, seed: undefined })} />}
    </div>
  )
}

export function AskLemProvider({ children }: { children: ReactNode }) {
  const { openSheet, closeTab, tabs } = useNav()
  const isOpen = tabs.some((t) => t.type === 'lem')

  const ask = useCallback<Ask>((seed, scope) => {
    const s = { ...HOME, ...(scope ?? {}) }
    openSheet({ type: 'lem', key: s.key, title: s.title, about: s.about, seed })
  }, [openSheet])
  const open = useCallback((scope?: Partial<ChatScope>) => {
    const existing = tabs.find((t) => t.type === 'lem')
    if (existing && !scope) { openSheet(existing); return }
    const s = { ...HOME, ...(scope ?? {}) }
    openSheet({ type: 'lem', key: s.key, title: s.title, about: s.about })
  }, [openSheet, tabs])
  const close = useCallback(() => closeTab('lem'), [closeTab])

  const [, force] = useState(0)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        if (isOpen) close(); else open()
        force((n) => n + 1)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [isOpen, open, close])

  return (
    <Ctx.Provider value={{ ask, open, close, isOpen }}>
      {children}
    </Ctx.Provider>
  )
}
