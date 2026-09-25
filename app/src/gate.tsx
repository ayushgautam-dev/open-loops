import { ArrowRight } from 'lucide-react'

/* What somebody sees when they open this app without being a member.
   Open Loops is not a place you join — it reads one person's mail and holds one
   person's commitments, and each pod stays invite-only for exactly that reason.
   So "Request access" is the wrong offer: it asks for something nobody is going to
   grant. What they actually want is their own copy, which is one click.

   The button is Lemma's own import page for the public repository: it makes a pod
   from the bundle there, and the app's first run does the rest (connect mail, install
   Lem's skills, read the last three weeks, set up their autopilots). These are
   build-time constants because a non-member cannot read the pod to look anything up. */
export const TEMPLATE = {
  repo: 'https://github.com/ayushgautam-dev/open-loops',
  install: 'https://lemma.work/import/github/ayushgautam-dev/open-loops',
}

export function CloneGate({ name }: { name?: string }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="fr-badge">Open Loops</div>
        <h1>This one belongs to somebody else.</h1>
        <p className="fr-line">
          {name ? `${name} is signed in, but this workspace is not shared. ` : ''}
          Open Loops reads one person's mail and holds one person's commitments, so
          each one stays private to its owner. Take your own copy instead — it arrives
          empty, connects to your accounts, and reads your last three weeks.
        </p>

        <div className="gate-steps">
          <div className="gate-step"><b>1</b><span>Install your own copy on Lemma — one click.</span></div>
          <div className="gate-step"><b>2</b><span>Open it and connect Gmail. Calendar and Granola are optional.</span></div>
          <div className="gate-step"><b>3</b><span>It reads your last three weeks and shows you what is waiting on you.</span></div>
        </div>

        <div className="btn-row" style={{ marginTop: 22 }}>
          <a className="btn primary lg" href={TEMPLATE.install} target="_blank" rel="noreferrer">
            Install your own copy <ArrowRight size={15} strokeWidth={2} />
          </a>
          <a className="btn quiet" href={TEMPLATE.repo} target="_blank" rel="noreferrer">See how it works</a>
        </div>
      </div>
    </div>
  )
}
