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
        <h1>This one is taken.</h1>
        <p className="fr-sub">{name ? `${name}, get` : 'Get'} your own Otto.</p>
        <div className="gate-steps">
          <div className="gate-step"><b>1</b><span>Install your copy</span></div>
          <div className="gate-step"><b>2</b><span>Connect your mail</span></div>
          <div className="gate-step"><b>3</b><span>See what is waiting on you</span></div>
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
