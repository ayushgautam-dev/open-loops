import {
  createContext, useContext, useState, useCallback, useMemo, useRef,
  type ReactNode,
} from 'react'
import { favicon } from './lib'

/* ---------------- toast ---------------- */
type ToastFn = (msg: string, undo?: () => void | Promise<void>) => void
const ToastCtx = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; undo?: () => void | Promise<void>; n: number } | null>(null)
  const n = useRef(0)
  const show = useCallback<ToastFn>((msg, undo) => {
    const id = ++n.current
    setT({ msg, undo, n: id })
    window.setTimeout(() => setT((cur) => (cur && cur.n === id ? null : cur)), 6000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className="toast" key={t.n} role="status">
          <span>{t.msg}</span>
          {t.undo && (
            <button onClick={async () => { await t.undo!(); setT(null) }}>Undo</button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

/* ---------------- faces ---------------- */
// Initials read better than a thumbnail-sized photo; photos only where a face can be seen.
const TINTS = ['#D9622B', '#3C78B5', '#7B5CD6', '#2F8A63', '#C7507A', '#B8861C', '#2F95A3', '#5F6FD0', '#B8543F']

export function initialsOf(name?: string | null): string {
  const n = (name || '').trim()
  if (!n) return '?'
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function tintFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

/** Gravatar invents a picture for addresses it does not know; `d=404` makes it admit it. */
function realPhoto(src?: string | null): string | null {
  if (!src) return null
  if (!/gravatar\.com/i.test(src)) return src
  return src.includes('?') ? `${src}&d=404` : `${src}?d=404`
}

export function Avatar({ name, src, size = 'sm', onClick }: {
  name?: string | null; src?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg'; onClick?: () => void
}) {
  const label = name || ''
  const [broken, setBroken] = useState(false)
  const url = size === 'lg' || size === 'md' ? realPhoto(src) : null
  const show = url && !broken
  return (
    <span className={`av av-${size}${onClick ? ' click' : ''}`} style={{ ['--tint' as string]: tintFor(label) }} title={label}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {show ? <img src={url!} alt="" onError={() => setBroken(true)} /> : initialsOf(label)}
    </span>
  )
}

export function Faces({ people, max = 4, onPick }: {
  people: { id?: string | null; name?: string | null; avatar_url?: string | null }[]; max?: number
  onPick?: (id: string) => void
}) {
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <span className="faces">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} src={p.avatar_url} size="xs"
          onClick={onPick && p.id ? () => onPick(p.id!) : undefined} />
      ))}
      {more > 0 && <span className="av av-xs more">+{more}</span>}
    </span>
  )
}

export function Logo({ name, domain, size = 'sm' }: { name: string; domain?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false)
  const src = favicon(domain)
  return (
    <span className={`logo logo-${size}`} style={{ ['--tint' as string]: tintFor(name) }}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : (name || '?')[0]}
    </span>
  )
}

/* ---------------- Lem's mark ---------------- */
/** Lem is a small living orb: still when idle, breathing while it works. */
export function Orb({ live, size = 18 }: { live?: boolean; size?: number }) {
  return <span className={`orb${live ? ' live' : ''}`} style={{ width: size, height: size }} aria-hidden><i /></span>
}

/* ---------------- states ---------------- */
export function Empty({ line, action }: { line: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-l">{line}</div>
      {action}
    </div>
  )
}

/** Shapes where rows will land — a page that holds its layout instead of spinning. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skel" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel-row" style={{ width: `${88 - i * 14}%` }} />)}
    </div>
  )
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
