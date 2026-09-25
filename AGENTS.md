# Working in this repository

For anyone — person or agent — changing this pod. How it behaves is in
[README.md](README.md); what Lem is told is in
[files/memory/AGENTS.md](files/memory/AGENTS.md) and the skills beside it.

## Setting a fresh pod up

```bash
git clone --depth 1 https://github.com/ayushgautam-dev/open-loops && cd open-loops
export LEMMA_POD_ID=<pod>     # already set inside a pod's own workspace
./setup.sh                    # ~3 min, then a note telling you what to say
```

Read [setup.sh](setup.sh) rather than reproducing it by hand. Or use the
Install button in the README — that runs only the import, and the app's first run does
the rest.

**Do not connect anybody's mail from setup.** A pod reads mail as whoever connected the
account. The app's first run is where each person connects their own; an agent doing it
on their behalf reads the wrong inbox into the wrong person's rows.

**What "verified" means here: reading the pod back.** `lemma pods describe`,
`lemma schedules list`, `lemma query run "select count(*) from autopilot_catalog"`
(twelve), `lemma files ls /skills`. Not a browser — every visitor to the app meets a
Lemma sign-in, and an agent has no session to get past it.

## What breaks, and why things are the way they are

- **A pod function cannot read row-secured rows when the app calls it directly.** It
  runs as a service identity and `select count(*)` comes back 0 however much data there
  is — no error, just silence. Any function the app calls takes its data as input; the
  app reads with its own SQL, which runs as the signed-in person. Functions run inside a
  workflow (as the run's user) read normally.
- **A schedule runs as whoever created it.** So autopilots are per person: the menu is
  `autopilot_catalog`, and each person's first run creates their own schedule per menu
  entry (`src/autopilot-sync.ts`, the same file in both apps). The platform allows one
  schedule per person per workflow — a copy is matched by `workflow_name` + `user_id`,
  never by name. Never ship personal schedules in the bundle.
- **Schedules keep the person's own clock.** They store `config.timezone`, so the cron
  is local time and the platform converts.
- **The one shared trigger** is `autopilot_loose_ends`, a DATASTORE schedule on
  `interactions` that runs as each row's owner. Its first step is `backfill_guard`: while
  a person's first import is running (`settings.backfill_until`), their triggered runs
  stand down, so hundreds of rows landing at once never become hundreds of concurrent
  runs — and nobody else's mail stops being read. Do not "fix" first run back to
  pausing the trigger; that pauses mail reading for the whole team.
- **`/skills` is read-only to the importer.** Skills ship as `/setup/skills/<name>.md`
  and are installed by `setup.sh` or by the app's first run (`ensureSkills`), which
  never overwrites a skill somebody has edited.
- **Send is the only way anything leaves.** `send_draft` and `send_invite` are called
  only from a person's click, held for a few seconds so it can be undone. No autopilot,
  and no Lem conversation, sends.
- **Nothing is saved without its source conversation and when it opened.** Items saved
  without them could never close automatically. `ingest_open_loops` enforces it.
- **Enum drift is the recurring bug class.** Lem writes human words the schema rejects,
  and one bad value used to fail a whole batch. Every enum column has a normaliser in
  the writer function; add one whenever you add an enum.
- **Real names never go in code, prompts or comments.** This repository is public; use
  invented examples.

## The apps

`apps/open-loops-desk/source/` and `apps/open-loops/source/` are **built output** —
uploaded as-is on import, no npm, no variables. Change the project in `desk/` or `app/`,
then run its `build.sh`. Shipping an edit without the rebuild changes nothing anybody
can see.

Both apps read the same tables and call the same functions; they differ only in layout.
A behaviour change in one almost always belongs in the other too.
