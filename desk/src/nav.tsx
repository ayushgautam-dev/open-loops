import {
  createContext, useContext, useState, useEffect, useCallback, type ReactNode,
} from 'react'

/* Where you are, and what you are looking at.

   Pages are the five places in the rail. Beside the page sits Focus: a panel of tabs.
   Everything you open gets a tab, so moving sideways never loses your place — open a
   company, then one of its items, and the company is still one click away. Opening
   something that is already open brings its tab forward; opening something from inside a
   tab puts the new tab right next to it, so related things sit together. */

export type Focus =
  | { type: 'person'; id: string; highlight?: string | null }
  | { type: 'company'; id: string }
  | { type: 'workstream'; id: string }
  | { type: 'doc'; id: string }
  | { type: 'loop'; id: string; nudge?: boolean }

export const focusKey = (f: Focus) => `${f.type}:${f.id}`

interface Nav {
  route: string
  navigate: (to: string) => void
  /** the tab in front, or null when Focus is closed */
  focus: Focus | null
  tabs: Focus[]
  /** open (or bring forward) a tab — from a page, it joins the end of the strip */
  open: (f: Focus) => void
  /** open from inside a tab — it lands right beside the tab you came from */
  push: (f: Focus) => void
  focusTab: (key: string) => void
  closeTab: (key: string) => void
  /** close every tab */
  close: () => void
  wide: boolean
  setWide: (v: boolean) => void
  bump: () => void
  version: number
}

const NavCtx = createContext<Nav>({
  route: '/', navigate: () => {}, focus: null, tabs: [],
  open: () => {}, push: () => {}, focusTab: () => {}, closeTab: () => {}, close: () => {},
  wide: false, setWide: () => {}, bump: () => {}, version: 0,
})
export const useNav = () => useContext(NavCtx)

/** True inside the Focus panel: opening from there lands beside the tab you came from. */
export const InFocus = createContext(false)
/** `open` on a page, `push` inside Focus — the right one for wherever a component sits. */
export function useOpener() {
  const nav = useNav()
  return useContext(InFocus) ? nav.push : nav.open
}

const MAX_TABS = 5

export function NavProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/')
  const [state, setState] = useState<{ tabs: Focus[]; active: string | null }>({ tabs: [], active: null })
  const [wide, setWide] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const on = () => setRoute(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const navigate = useCallback((to: string) => { window.location.hash = to }, [])

  const add = useCallback((f: Focus, beside: boolean) => setState(({ tabs, active }) => {
    const k = focusKey(f)
    const at = tabs.findIndex((x) => focusKey(x) === k)
    if (at >= 0) {
      // already open: refresh its details (a nudge flag, say) and bring it forward
      const next = [...tabs]; next[at] = f
      return { tabs: next, active: k }
    }
    let next = [...tabs]
    const from = beside && active ? next.findIndex((x) => focusKey(x) === active) : -1
    if (from >= 0) next.splice(from + 1, 0, f)
    else next.push(f)
    // over the limit, the oldest tab that isn't the one you came from gives way
    while (next.length > MAX_TABS) {
      const drop = next.findIndex((x) => focusKey(x) !== active && focusKey(x) !== k)
      next = next.filter((_, i) => i !== (drop >= 0 ? drop : 0))
    }
    return { tabs: next, active: k }
  }), [])

  const open = useCallback((f: Focus) => add(f, false), [add])
  const push = useCallback((f: Focus) => add(f, true), [add])
  const focusTab = useCallback((k: string) => setState((s) => ({ ...s, active: k })), [])
  const closeTab = useCallback((k: string) => setState(({ tabs, active }) => {
    const i = tabs.findIndex((x) => focusKey(x) === k)
    const next = tabs.filter((x) => focusKey(x) !== k)
    if (active !== k) return { tabs: next, active }
    // closing the tab in front shows its left neighbour — usually where you came from
    const neighbour = next[Math.max(0, i - 1)]
    return { tabs: next, active: neighbour ? focusKey(neighbour) : null }
  }), [])
  const close = useCallback(() => setState({ tabs: [], active: null }), [])
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const focus = state.tabs.find((t) => focusKey(t) === state.active) ?? null

  useEffect(() => {
    document.body.classList.toggle('focus-open', !!focus)
    document.body.classList.toggle('focus-wide', !!focus && wide)
  }, [focus, wide])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Escape' || !focus) return
      if (t?.closest?.('input,textarea,[contenteditable]')) return
      if (document.querySelector('.lem.open, .palette')) return   // those own Escape first
      closeTab(focusKey(focus))
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [focus, closeTab])

  return (
    <NavCtx.Provider value={{
      route, navigate, focus, tabs: state.tabs, open, push, focusTab, closeTab, close, wide, setWide, bump, version,
    }}>
      {children}
    </NavCtx.Provider>
  )
}
