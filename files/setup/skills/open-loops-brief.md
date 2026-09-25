---
name: open-loops-brief
description: "Compose the morning brief, and work out what to raise in a recurring meeting. Use for the daily brief run, before a meeting, or when asked what is coming up or what to cover with someone. Covers grounding every line in a real commitment and the once-a-day sending rule."
---

# Briefing

Two jobs, same discipline: say only what is true, and only what is useful before the
person walks into something.

---

## The morning brief

Once a day. Compose it, store it, send it — to the person themselves and nobody else.

1. **Today's and tomorrow's meetings** — `fetch_calendar_events` with
   `{"past_days":0,"future_days":1}`.
2. **What is owed** — open commitments on the person's side, with the people they belong
   to.
3. **Compose it in markdown:**
   - A short greeting line.
   - **One block per meeting today:** time, title, who is coming, and for each attendee
     with something outstanding, what it is, stated specifically. If nothing is
     outstanding, say "nothing outstanding".
   - **Overdue** at the bottom, oldest first.
   - Close with: *"Nothing else will interrupt you today."*
   - If there are no meetings, say so plainly and keep it to three lines.
4. **Store one row** in `briefs`: `{content, source:"auto", composed_on:<YYYY-MM-DD>}`.
5. **Send it** with `send_brief_email`.

**Ground every "what you owe" line in a real commitment.** Never invent one to make a
meeting block look fuller.

**Send once.** If it reports the brief has already gone, or that nothing is composed, say
so and stop — never force a second copy. The promise this product makes is fewer
interruptions, not more.

---

## What to raise next time

Before a recurring meeting, answer the only question that matters: *what should I actually
say when this starts?*

Build it from three things:

- **Still unresolved** — what was raised in an earlier meeting and never landed.
- **Promised and not delivered** — by either side, with how long it has been.
- **New since last time** — something that happened that the other person does not know
  yet, and would want to.

**Write it as three or four lines, each one a thing to say.** Not a status report.

> *Priya's start date — still unconfirmed after two weeks. You said you'd come back on it.*

**What does not belong:** anything already settled, anything purely administrative, and
anything the person would find obvious. If there is genuinely nothing worth raising, say
that in one line. An honest empty agenda is more useful than a padded one.


