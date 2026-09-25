#input_type_name: RecordInput
#output_type_name: RecordResult
#function_name: record_interaction

# The ledger writer. Every source — Gmail, Calendar, Meet, Granola, Slack — lands
# here and nowhere else, which is what lets one DATASTORE trigger on `interactions`
# drive the whole understanding layer regardless of where a row came from.
#
# This function forms no opinion about content. It parses, normalises, dedupes and
# writes. Deciding what an interaction *means* is the extractor's job.
#
# Two destinations per interaction:
#   - a row in `interactions` (light: who, when, subject, pointer)
#   - the raw body as a markdown file under /me (searchable: the second brain's corpus)
#
# /me is delegated, so a run started by a user's own row writes into that user's
# private tree. Nothing here crosses between people.

import re
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

CORPUS_ROOT = "/me/people"
UNFILED = "/me/interactions"


class InteractionIn(BaseModel):
    kind: str                                  # email | meeting | message
    source: str                                # gmail | calendar | meet | granola | slack | manual
    external_id: str                           # RFC Message-ID, event id, meeting id — the idempotency key
    occurred_at: str
    thread_ref: str | None = None
    subject: str | None = None
    body: str | None = None                    # raw text; goes to a file, never to a column
    direction: str | None = None               # inbound | outbound | internal
    addressed_to_me: bool = True
    person_email: str | None = None            # the counterparty, if the source knows it
    company_domain: str | None = None
    participants: list[dict] = Field(default_factory=list)


class RecordInput(BaseModel):
    interactions: list[InteractionIn] = Field(default_factory=list)


class RecordResult(BaseModel):
    created: int = 0
    skipped_duplicate: int = 0
    files_written: int = 0
    unresolved_people: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


_KIND = {"email", "meeting", "message"}
_SOURCE = {"gmail", "calendar", "meet", "granola", "slack", "manual"}
_DIRECTION = {"inbound", "outbound", "internal"}


def _norm_email(e: str | None) -> str:
    e = (e or "").strip().lower()
    m = re.match(r"^.*?<([^>]+)>$", e)
    return (m.group(1) if m else e).strip()


def _norm_domain(d: str | None) -> str:
    d = (d or "").strip().lower()
    if not d:
        return ""
    d = re.sub(r"^https?://", "", d).split("/")[0]
    return d[4:] if d.startswith("www.") else d


def _norm_kind(k: str | None) -> str:
    k = (k or "").strip().lower()
    if k in _KIND:
        return k
    if k in ("call", "transcript", "note"):
        return "meeting"
    if k in ("slack", "dm", "chat"):
        return "message"
    return "email"


def _norm_source(s: str | None) -> str:
    s = (s or "").strip().lower()
    if s in _SOURCE:
        return s
    if s in ("mail", "email", "google_mail"):
        return "gmail"
    if s in ("google_calendar", "gcal"):
        return "calendar"
    if s in ("fireflies", "transcript"):
        return "meet"
    return "manual"


def _norm_direction(d: str | None) -> str | None:
    d = (d or "").strip().lower()
    if d in _DIRECTION:
        return d
    if d in ("sent", "outgoing", "from_me"):
        return "outbound"
    if d in ("received", "incoming", "to_me"):
        return "inbound"
    return None


def _iso(ts: str | None) -> str:
    raw = (ts or "").strip()
    if not raw:
        return datetime.now(timezone.utc).isoformat()
    # An offset in the source ("…T11:30:00+05:30") is the truth: convert it. Only a
    # timestamp with no offset at all is assumed to be UTC. This used to overwrite the
    # offset with UTC instead of converting, so every calendar event and meeting note
    # landed 5h30m late for an IST calendar ("Daily Catchup at 3:00" for a 9:30 PM call).
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return raw


def _slug(text: str, limit: int = 60) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return (s[:limit].rstrip("-")) or "untitled"


def _folder(person_email: str) -> str:
    return f"{CORPUS_ROOT}/{_slug(person_email, 80)}" if person_email else UNFILED


async def record_interaction(ctx: FunctionContext, data: RecordInput) -> RecordResult:
    pod = Pod.from_env()
    res = RecordResult()

    def rows(sql: str) -> list[dict]:
        return pod.query(sql).to_dict()["items"]

    seen = {r["external_id"] for r in rows(
        "select external_id from interactions where external_id is not null")}
    person_by_email = {r["email"]: r["id"] for r in rows(
        "select id, email from people where email is not null")}
    company_by_domain = {r["domain"]: r["id"] for r in rows(
        "select id, domain from companies where domain is not null")}

    batch: list[dict] = []
    for item in data.interactions:
        ext = (item.external_id or "").strip()
        if not ext:
            res.errors.append("interaction without external_id skipped")
            continue
        if ext in seen:
            res.skipped_duplicate += 1
            continue
        seen.add(ext)

        occurred = _iso(item.occurred_at)
        email = _norm_email(item.person_email)
        domain = _norm_domain(item.company_domain)

        row: dict = {
            "kind": _norm_kind(item.kind),
            "source": _norm_source(item.source),
            "external_id": ext[:300],
            "occurred_at": occurred,
            "addressed_to_me": bool(item.addressed_to_me),
        }
        if item.thread_ref:
            row["thread_ref"] = item.thread_ref[:300]
        if item.subject:
            row["subject"] = item.subject
        direction = _norm_direction(item.direction)
        if direction:
            row["direction"] = direction
        if item.participants:
            row["participants"] = item.participants
        if email and email in person_by_email:
            row["person_id"] = person_by_email[email]
        elif email:
            res.unresolved_people.append(email)
        if domain and domain in company_by_domain:
            row["company_id"] = company_by_domain[domain]

        # The body is the corpus. Markdown so the pod indexes it; a front-matter
        # header so a retrieved chunk still says who and when on its own.
        if item.body and item.body.strip():
            path = f"{_folder(email)}/{occurred[:10]}-{_slug(item.subject or row['kind'])}-{_slug(ext, 24)}.md"
            header = (
                f"# {item.subject or row['kind'].title()}\n\n"
                f"- when: {occurred}\n"
                f"- source: {row['source']}\n"
                f"- with: {email or 'unknown'}\n"
                f"- direction: {direction or 'unknown'}\n\n---\n\n"
            )
            try:
                pod.files.write_text(path, header + item.body.strip())
                row["body_ref"] = path
                res.files_written += 1
            except Exception as exc:                      # a lost body must not lose the row
                res.errors.append(f"file write failed for {ext[:40]}: {exc}")

        batch.append(row)

    if batch:
        pod.records.bulk_create("interactions", batch)
        res.created = len(batch)

    return res
