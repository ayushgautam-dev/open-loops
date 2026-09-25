---
name: open-loops-work
description: "Produce a piece of work the person asked for — research on a person, company or market; an analysis over numbers; a recap, one-pager or brief; a structured artifact. Use when the ask is something built rather than something said. Covers sourcing, what a finished document looks like, and where it is filed."
---

# Doing the work

Some obligations are not a message but a **piece of work**: a competitive read, a
one-pager, a recap, a model, a background brief before a first meeting.

There is no routing step and no specialist to hand to. Read the ask, decide what would
actually answer it, and produce that.

## Before you start

- **Read the ask properly.** If it came from a commitment, read that commitment, the
  person it belongs to, and the last few timeline entries. The person's own words in a
  quote are worth more than any summary.
- **One sentence of scope, only if genuinely ambiguous.** Otherwise start. Asking twice
  is worse than making a reasonable assumption and naming it in the output.

## Sourcing

- For a person or company, `research_person` and `research_company` already exist —
  use them rather than starting from a blank search.
- For anything outside the pod, use web search and **say where each claim came from**.
- For anything inside the pod, query the datastore directly. It is Postgres.
- **Never invent a number, a date, a funding round or a headcount.** If a fact cannot be
  found, write that it could not be found. A confident wrong number destroys more trust
  than a gap.

## What a finished document looks like

- **Leads with the answer.** The first two sentences say what the person needs to know.
  No preamble, no "in this document we will".
- **Headings and bullets, not essays.**
- **Specifics over adjectives** — dates, amounts, names. Never "significant" or "robust".
- **Says what is uncertain**, in one line, where it matters.
- **Ends where it ends.** No summary of the summary, no next-steps section nobody asked
  for.
- **As long as it needs to be and no longer.** Most good answers are under a page.

## Filing it

- Write the document to a file under `/me/` and record it in `deliverables` so it is
  reachable later. If it may go to someone else, follow "A document goes out the way a
  professional would send it" in the open-loops-write skill: choose its `format`, keep
  `doc_url` for real web links only, and keep every trace of this workspace out of the
  document itself.
- Attach it to the person or company it concerns when there is an obvious one, so it
  appears on their record.
- Then say **one line** in chat: what it is and that it is ready. Never paste the whole
  document into the conversation.

## Rules

- Never send anything. Producing work is not the same as delivering it.
- Never change pod configuration as a side effect of doing research.
- If the work turns out to be trivial — a one-line answer — just answer. Do not
  manufacture a document to look busy.


