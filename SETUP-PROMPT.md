# The setup prompt

Paste this into a fresh pod's chat.

```
Set this pod up from https://github.com/ayushgautam-dev/open-loops: clone it and run
./setup.sh — nothing else, and nothing invented. It ends with a note addressed to
you; follow it.
```

`setup.sh` says almost nothing while it works and ends with a note addressed to the
**agent**: what to tell the person, in prose, and what to do when they answer.

Three things it must not discover the hard way, and the note says so:

- **Reading mail is the person's step, not the agent's.** The app's first run connects
  *their* account and reads *their* mail as them, into rows only they can see. An
  agent that connects an account on somebody's behalf reads the wrong inbox.
- **Never send.** Otto writes drafts. Only the person's own Send, in the app, sends.
- **No browser, no npm, no widget.** The app is already built and puts a Lemma sign-in
  in front of every visitor; an agent has no session to get past it. Verification is
  reading the pod back — `lemma pods describe`, `lemma schedules list`,
  `lemma query run "select count(*) from autopilot_catalog"`.

The same repository also installs with one click, from the button in the
[README](README.md). That path runs only the import; the app's first run then does
everything `setup.sh` does after it.
