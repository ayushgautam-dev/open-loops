import {
  createContext, useContext, useState, useCallback, useMemo,
  type ReactNode,
} from 'react'

/* ---------------- toast ---------------- */
type ToastFn = (msg: string, undo?: () => void | Promise<void>) => void
const ToastCtx = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; undo?: () => void | Promise<void> } | null>(null)
  const show = useCallback<ToastFn>((msg, undo) => {
    setT({ msg, undo })
    window.setTimeout(() => setT((cur) => (cur && cur.msg === msg ? null : cur)), 6000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className="toast">
          <span>{t.msg}</span>
          {t.undo && (
            <button onClick={async () => { await t.undo!(); setT(null) }}>Undo</button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

/* ---------------- avatars ---------------- */
// Bright enough to tell people apart at 22px — initials read better than a photo that
// small. Photos are only used where the avatar is big enough to see a face.
const TINTS = ['#e0703a', '#3b82c4', '#8a63d2', '#2e9c74', '#d4537c', '#c28f1d', '#3a9aa8', '#6d7ad8', '#c4574a']

export function initialsOf(name?: string | null): string {
  const n = (name || '').trim()
  if (!n) return '?'
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function tintFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

/** Gravatar invents a picture when the address has no account, which reads as
 *  visual noise next to real faces. `d=404` makes it admit there is none, so we
 *  fall through to initials. */
function realPhoto(src?: string | null): string | null {
  if (!src) return null
  if (!/gravatar\.com/i.test(src)) return src
  return src.includes('?') ? `${src}&d=404` : `${src}?d=404`
}

export function Avatar({ name, src, large, onClick }: {
  name?: string | null; src?: string | null; large?: boolean; onClick?: () => void
}) {
  const label = name || ''
  const [broken, setBroken] = useState(false)
  const url = large ? realPhoto(src) : null
  const show = url && !broken
  return (
    <span className={`av${large ? ' lg' : ''}${onClick ? ' click' : ''}`} style={{ background: tintFor(label) }} title={label}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {show
        ? <img src={url!} alt="" onError={() => setBroken(true)} />
        : initialsOf(label)}
    </span>
  )
}

export function Avatars({ people, max = 5, onPick }: {
  people: { id?: string | null; name?: string | null; avatar_url?: string | null }[]; max?: number
  onPick?: (id: string) => void
}) {
  const shown = people.slice(0, max)
  return (
    <span className="avs">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} src={p.avatar_url}
          onClick={onPick && p.id ? () => onPick(p.id!) : undefined} />
      ))}
    </span>
  )
}

/* ---------------- states ---------------- */
export function Empty({ line, action }: { line: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{line}</div>
      {action}
    </div>
  )
}

export function Loading() {
  return <div className="empty"><div className="spinner" /></div>
}

/* ---------------- markdown ----------------
   Deliberately small: headings, lists, tables, bold/italic/code and links.
   Documents render through this, so it has to look like a document — never
   like raw markdown leaking into the page. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyBase}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      out.push(<a key={k} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>)
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const nodes = useMemo(() => {
    const lines = (text || '').replace(/\r/g, '').split('\n')
    const out: ReactNode[] = []
    let para: string[] = []
    let list: { ordered: boolean; items: string[] } | null = null
    let table: string[][] | null = null
    let k = 0

    const flushPara = () => {
      if (!para.length) return
      out.push(<p key={`p${k++}`}>{inline(para.join(' '), `p${k}`)}</p>)
      para = []
    }
    const flushList = () => {
      if (!list) return
      const L = list.ordered ? 'ol' : 'ul'
      out.push(
        <L key={`l${k++}`}>
          {list.items.map((it, i) => <li key={i}>{inline(it, `li${k}-${i}`)}</li>)}
        </L>,
      )
      list = null
    }
    const flushTable = () => {
      if (!table || !table.length) { table = null; return }
      const [head, ...body] = table
      out.push(
        <table key={`t${k++}`}>
          <thead><tr>{head.map((c, i) => <th key={i}>{inline(c, `th${i}`)}</th>)}</tr></thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `td${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      )
      table = null
    }
    const flushAll = () => { flushPara(); flushList(); flushTable() }

    for (const raw of lines) {
      const line = raw.trimEnd()
      if (!line.trim()) { flushAll(); continue }

      if (/^\|.*\|$/.test(line.trim())) {
        const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim())
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue   // separator row
        flushPara(); flushList()
        ;(table ||= []).push(cells)
        continue
      }
      flushTable()

      const h = /^(#{1,4})\s+(.*)$/.exec(line)
      if (h) {
        flushAll()
        const L = (['h1', 'h2', 'h3', 'h3'] as const)[h[1].length - 1]
        out.push(<L key={`h${k++}`}>{inline(h[2], `h${k}`)}</L>)
        continue
      }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushAll(); out.push(<hr key={`hr${k++}`} />); continue }

      const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
      if (ul || ol) {
        flushPara()
        const ordered = !!ol
        if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
        list.items.push((ul ? ul[1] : ol![1]))
        continue
      }
      flushList()
      para.push(line.trim())
    }
    flushAll()
    return out
  }, [text])

  return <div className="md">{nodes}</div>
}
