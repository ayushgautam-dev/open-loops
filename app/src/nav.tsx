import {
  createContext, useContext, useState, useEffect, useCallback, type ReactNode,
} from 'react'

/* The right-hand workspace.

   It used to be a modal drawer: a scrim dimmed the page and only one thing could be
   open. Now it is a pane beside the page — roughly half the screen, nothing dimmed,
   both sides usable — holding a few tabs: Lem, a person, a company, an item (its
   conversation and whatever Lem prepared for it), a document. Opening something that
   is already open just brings its tab forward. */
export type SheetTarget =
  | { type: 'person'; id: string; highlight?: string | null }
  | { type: 'company'; id: string }
  | { type: 'workstream'; id: string }
  | { type: 'doc'; id: string }
  | { type: 'loop'; id: string; nudge?: boolean }
  | { type: 'lem'; key?: string; title?: string; about?: string; seed?: string }

export const tabKey = (t: NonNullable<SheetTarget>) =>
  t.type === 'lem' ? 'lem' : `${t.type}:${t.id}`

interface Nav {
  route: string
  navigate: (to: string) => void
  /** the tab in front, or null when the pane is closed */
  sheet: SheetTarget | null
  tabs: SheetTarget[]
  /** open (or bring forward) a tab; null closes the whole pane */
  openSheet: (t: SheetTarget | null) => void
  closeTab: (key: string) => void
  focusTab: (key: string) => void
  bump: () => void
  version: number
}

const NavCtx = createContext<Nav>({
  route: '/', navigate: () => {}, sheet: null, tabs: [],
  openSheet: () => {}, closeTab: () => {}, focusTab: () => {}, bump: () => {}, version: 0,
})
export const useNav = () => useContext(NavCtx)

const MAX_TABS = 6

export function NavProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/')
  const [tabs, setTabs] = useState<SheetTarget[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const on = () => setRoute(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  // Moving between pages keeps the pane: the point is to work on both at once.
  const navigate = useCallback((to: string) => { window.location.hash = to }, [])

  const openSheet = useCallback((t: SheetTarget | null) => {
    if (!t) { setTabs([]); setActive(null); return }
    const k = tabKey(t)
    setTabs((cur) => {
      const i = cur.findIndex((x) => tabKey(x) === k)
      if (i >= 0) { const next = [...cur]; next[i] = t; return next }
      return [...cur, t].slice(-MAX_TABS)
    })
    setActive(k)
  }, [])

  const closeTab = useCallback((k: string) => {
    setTabs((cur) => {
      const i = cur.findIndex((x) => tabKey(x) === k)
      const next = cur.filter((x) => tabKey(x) !== k)
      setActive((a) => (a === k ? (next[Math.max(0, i - 1)] ? tabKey(next[Math.max(0, i - 1)]) : null) : a))
      return next
    })
  }, [])

  const focusTab = useCallback((k: string) => setActive(k), [])
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const sheet = tabs.find((t) => tabKey(t) === active) ?? null

  useEffect(() => {
    document.body.classList.toggle('pane-open', tabs.length > 0)
  }, [tabs.length])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active && !(e.target as HTMLElement)?.closest?.('input,textarea')) closeTab(active)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [active, closeTab])

  return (
    <NavCtx.Provider value={{ route, navigate, sheet, tabs, openSheet, closeTab, focusTab, bump, version }}>
      {children}
    </NavCtx.Provider>
  )
}
