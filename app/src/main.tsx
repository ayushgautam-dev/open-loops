import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGuard, useCurrentUser } from 'lemma-sdk/react'
import { Inbox, Users, Layers, FileText, Zap, Moon, Sun, MessageCircle } from 'lucide-react'
import { lemmaClient } from './lemma-client'
import { useSql, rev, firstName } from './lib'
import { ToastProvider, Avatar } from './ui'
import { NavProvider, useNav } from './nav'
import { Pane } from './drawer'
import { AskLemProvider, useAskLem, useLemPanel } from './asklem'
import { CommandPalette } from './cmdk'
import { Feed } from './screens/feed'
import { Workstreams } from './screens/workstreams'
import { People } from './screens/people'
import { Docs } from './screens/docs'
import { Autopilots } from './screens/autopilots'
import { FirstRun, needsFirstRun } from './screens/firstrun'
import { CloneGate } from './gate'
import { ensureMyAutopilots, ensureSkills } from './autopilot-sync'
import './styles.css'

const queryClient = new QueryClient()

function Rail({ email, name }: { email: string; name: string }) {
  const { route, navigate, version } = useNav()
  const lem = useLemPanel()
  const counts = useSql<{ mine: number; ready: number }>(rev(
    `select (select count(*) from loops where side='you' and status='open') as mine,
            (select count(*) from drafts d join loops l on l.id=d.loop_id where d.status='pending' and l.status='open') as ready`,
    version))
  const c = counts.items[0]
  const is = (r: string) => (r === '/' ? route === '/' : route.startsWith(r))

  const Item = ({ to, label, icon: Icon, n, hot }: {
    to: string; label: string; icon: typeof Inbox; n?: number | null; hot?: boolean
  }) => (
    <button className={is(to) ? 'on' : ''} onClick={() => navigate(to)}>
      <Icon size={15} strokeWidth={1.9} />
      <span>{label}</span>
      {n ? <span className={`n${hot ? ' hot' : ''}`}>{n}</span> : null}
    </button>
  )

  return (
    <nav className="rail">
      <div className="brand"><i />Open Loops</div>
      <div className="nav">
        <Item to="/" label="Feed" icon={Inbox}
          n={c ? Number(c.mine) || null : null} />
        {c && Number(c.ready) > 0 && (
          <div className="ready-hint">{Number(c.ready)} ready to send</div>
        )}
        <Item to="/workstreams" label="Workstreams" icon={Layers} />
        <Item to="/people" label="People" icon={Users} />
        <Item to="/docs" label="Docs" icon={FileText} />
        <Item to="/autopilots" label="Autopilots" icon={Zap} />
      </div>
      <div className="nav" style={{ marginTop: 14 }}>
        <button className={lem.isOpen ? 'on' : ''} onClick={() => (lem.isOpen ? lem.close() : lem.open())}>
          <MessageCircle size={15} strokeWidth={1.9} />
          <span>Lem</span>
          <span className="n">⌘J</span>
        </button>
      </div>
      <div className="rail-foot">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="kbd">⌘K</div>
          <ThemeToggle />
        </div>
        <button className="you">
          <Avatar name={name} />
          <span style={{ minWidth: 0 }}>
            <span className="em">{email}</span>
          </span>
        </button>
      </div>
    </nav>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const saved = localStorage.getItem('ol-theme')
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved)
      setDark(saved === 'dark')
    }
  }, [])
  return (
    <button
      className="btn quiet"
      title="Theme"
      onClick={() => {
        const n = dark ? 'light' : 'dark'
        document.documentElement.setAttribute('data-theme', n)
        localStorage.setItem('ol-theme', n)
        setDark(!dark)
      }}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}

function Shell({ name, email }: { name: string; email: string }) {
  const { route } = useNav()
  const askLem = useAskLem()
  let screen: React.ReactNode
  if (route.startsWith('/workstreams')) screen = <Workstreams />
  else if (route.startsWith('/people')) screen = <People />
  else if (route.startsWith('/docs')) screen = <Docs />
  else if (route.startsWith('/autopilots')) screen = <Autopilots />
  else screen = <Feed userName={name} />
  // anyone missing their own copy of a default autopilot gets it quietly; anything they
  // switched off stays off
  useEffect(() => { void ensureSkills().catch(() => 0); void ensureMyAutopilots().catch(() => 0) }, [])

  return (
    <div className="shell">
      <Rail email={email} name={name} />
      <div className="main">
        {screen}
      </div>
      <Pane />
      <CommandPalette onAsk={(t) => askLem(t)} />
    </div>
  )
}

function App() {
  const { user } = useCurrentUser({ client: lemmaClient })
  const [fresh, setFresh] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    // `?onboarding=1` replays first run on a pod that already has data — the only
    // way to look at that screen once you are past it, and the honest way to test
    // a change to it rather than guessing.
    if (new URLSearchParams(window.location.search).get('onboarding') === '1') {
      setFresh(true)
      return () => { live = false }
    }
    needsFirstRun().then((v) => { if (live) setFresh(v) }).catch(() => { if (live) setFresh(false) })
    return () => { live = false }
  }, [])
  const u = user as { email?: string; name?: string } | undefined
  const email = u?.email ?? ''
  const name = firstName(u?.name || u?.email?.split('@')[0] || 'there')
    .replace(/^\w/, (m) => m.toUpperCase())
  return (
    <NavProvider>
      <ToastProvider>
        <AskLemProvider>
          {fresh
            ? <FirstRun name={name} onDone={() => setFresh(false)} />
            : <Shell name={name} email={email} />}
        </AskLemProvider>
      </ToastProvider>
    </NavProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGuard
        client={lemmaClient}
        appName="Open Loops"
        loadingFallback={<div className="page"><div className="empty"><div className="spinner" /></div></div>}
        /* A visitor is never going to be let into somebody else's mail, so the
           default "Request access" button only sets up a wait that ends in nothing.
           Offer them the copy they actually want instead. */
        accessRequestFallback={({ user }) => (
          <CloneGate name={user?.name || user?.email || undefined} />
        )}
      >
        <App />
      </AuthGuard>
    </QueryClientProvider>
  </React.StrictMode>,
)
