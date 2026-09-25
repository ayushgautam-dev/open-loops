#input_type_name: SyncGranolaInput
#output_type_name: SyncGranolaResult
#function_name: sync_granola

# Granola -> the interaction ledger, over Granola's hosted MCP server.
#
# Why this matters more than any other source: promises live here. "I'll send you
# the deck" is said out loud on a call and written down nowhere else. Email gives us
# what people wrote; only meeting notes give us what people said.
#
# Free-tier shaped on purpose. Granola's free plan exposes `list_meetings` and
# `get_meetings` (notes plus action items, last 30 days) but NOT `get_meeting_transcript`,
# which is paid. Action items carry the promises, so the free tier is enough and this
# function never asks for the transcript.
#
# We copy the note text into our own store. On the free plan Granola deletes notes
# after 30 days — if we do not keep a copy, the evidence behind a promise disappears.
#
# Operation ids are inputs rather than constants because an MCP server's operations
# are discovered per install, so they can differ between orgs.

import re
from datetime import datetime, timedelta, timezone
from html import unescape
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class SyncGranolaInput(BaseModel):
    # Granola's window is a closed enum — this_week | last_week | last_30_days.
    # There is no `since` and no `limit`; passing them silently changes nothing.
    time_range: str = "last_30_days"
    batch_size: int = 10
    app: str = "granola"
    list_op: str = "list_meetings"
    get_op: str = "get_meetings"


class SyncGranolaResult(BaseModel):
    listed: int = 0
    shaped: int = 0
    recorded: int = 0
    skipped_duplicate: int = 0
    files_written: int = 0
    errors: list[str] = Field(default_factory=list)


def _unwrap(resp: dict) -> dict:
    r = resp.get("result", resp) if isinstance(resp, dict) else {}
    return r.get("data", r) if isinstance(r, dict) else {}


def _first_list(o, keys=("meetings", "documents", "items", "results")):
    if isinstance(o, list):
        return o
    if isinstance(o, dict):
        for k in keys:
            if isinstance(o.get(k), list):
                return o[k]
        for v in o.values():
            got = _first_list(v, keys)
            if got:
                return got
    return []


def _text(m: dict) -> str:
    """Notes and action items, whatever Granola called the fields this time."""
    parts = []
    for key in ("notes", "notes_markdown", "summary", "content", "overview", "text"):
        v = m.get(key)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
            break
    actions = m.get("action_items") or m.get("actionItems") or m.get("tasks")
    if isinstance(actions, list) and actions:
        lines = []
        for a in actions:
            if isinstance(a, str):
                lines.append(f"- {a}")
            elif isinstance(a, dict):
                t = a.get("text") or a.get("title") or a.get("description") or ""
                who = a.get("owner") or a.get("assignee") or ""
                if t:
                    lines.append(f"- {t}" + (f" (owner: {who})" if who else ""))
        if lines:
            parts.append("## Action items\n" + "\n".join(lines))
    return "\n\n".join(parts)




# Granola does not answer in JSON. Every tool returns one blob of XML-ish text under
# result.text, meant to be read by a model:
#
#   <meetings_data from="Aug 21, 2026" to="Sep 11, 2026" count="4">
#   <meeting id="c710d816-…" title="Acme &lt;&gt; Example" date="Sep 11, 2026 11:30 AM GMT+5:30" …>
#       <known_participants>Dana Reed &lt;dana@example.com&gt;, Sam Ortiz … </known_participants>
#   </meeting>
#
# The previous version looked for a list of dicts, found none, and reported zero
# meetings without error — which reads exactly like "you have no meetings".

_MEETING_RE = re.compile(r"<meeting\b([^>]*)>(.*?)</meeting>", re.S | re.I)
_ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"')
_PARTS_RE = re.compile(r"<known_participants>(.*?)</known_participants>", re.S | re.I)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def _resp_text(resp: dict) -> str:
    """The one place Granola puts everything."""
    r = resp.get("result", resp) if isinstance(resp, dict) else {}
    if isinstance(r, dict):
        for key in ("text", "content", "output"):
            v = r.get(key)
            if isinstance(v, str) and v.strip():
                return v
        d = r.get("data")
        if isinstance(d, dict):
            v = d.get("text")
            if isinstance(v, str):
                return v
        if isinstance(d, str):
            return d
    return r if isinstance(r, str) else ""


def _parse_meetings(text: str) -> list[dict]:
    out = []
    for attrs_raw, inner in _MEETING_RE.findall(text or ""):
        attrs = {k.lower(): unescape(v) for k, v in _ATTR_RE.findall(attrs_raw)}
        mid = (attrs.get("id") or "").strip()
        if not mid:
            continue
        people = []
        pm = _PARTS_RE.search(inner or "")
        if pm:
            blob = unescape(pm.group(1))
            for em in _EMAIL_RE.findall(blob):
                people.append(em.strip().lower())
        out.append({
            "id": mid,
            "title": (attrs.get("title") or "Meeting notes").strip(),
            "date": (attrs.get("date") or "").strip(),
            "emails": people,
            "inner": inner or "",
        })
    return out


def _parse_when(raw: str) -> str:
    """'Sep 11, 2026 11:30 AM GMT+5:30' -> ISO. Fall back to the date alone."""
    v = (raw or "").strip()
    if not v:
        return ""
    off = timezone.utc
    m = re.search(r"GMT([+-])(\d{1,2}):?(\d{2})?", v)
    if m:
        sign = 1 if m.group(1) == "+" else -1
        off = timezone(sign * timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0)))
        v = v[:m.start()].strip()
    for fmt in ("%b %d, %Y %I:%M %p", "%b %d, %Y %H:%M", "%b %d, %Y"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=off).isoformat()
        except ValueError:
            continue
    return ""


def _account_for(pod, app: str) -> str | None:
    """Which connected account to use for this app.

    Two MCP installs live side by side here (Granola and a transcript server) and
    both report is_default, so omitting the account lets the server pick whichever
    it likes — which is how Granola calls ended up running against the wrong one.
    Resolve it by name every time rather than hardcoding an id.
    """
    try:
        cfgs = pod.connectors.auth_configs.list().to_dict()
        items = cfgs.get("items", cfgs) if isinstance(cfgs, dict) else cfgs
        cfg_id = next(
            (c.get("id") for c in items if str(c.get("name", "")).lower() == app.lower()),
            None,
        )
        if not cfg_id:
            return None
        accts = pod.connectors.accounts.list().to_dict()
        rows = accts.get("items", accts) if isinstance(accts, dict) else accts
        for a in rows:
            if str(a.get("auth_config_id")) == str(cfg_id) and a.get("status") == "CONNECTED":
                return a.get("id")
    except Exception:
        return None
    return None


async def sync_granola(ctx: FunctionContext, data: SyncGranolaInput) -> SyncGranolaResult:
    pod = Pod.from_env()
    res = SyncGranolaResult()
    me = (ctx.user_email or "").lower()

    account_id = _account_for(pod, data.app)

    try:
        listed = pod.connectors.execute(
            data.app, data.list_op, {"time_range": data.time_range},
            account_id=account_id).to_dict()
    except Exception as exc:
        res.errors.append(
            f"list failed ({data.app}/{data.list_op}): {str(exc)[:200]}. "
            "If Granola is not connected yet, connect it first; if the operation id "
            "differs on this install, pass list_op/get_op explicitly.")
        return res

    list_text = _resp_text(listed)
    if "<access_notice>" in list_text:
        notice = list_text.split("<access_notice>", 1)[1].split("</access_notice>", 1)[0]
        res.errors.append(f"Granola: {notice.strip()[:160]}")

    meetings = _parse_meetings(list_text)
    res.listed = len(meetings)

    # Notes come from a second call. The parameter is `meeting_ids` (not `ids`) and it
    # accepts at most ten, so ask in batches rather than one request per meeting.
    notes: dict[str, str] = {}
    for i in range(0, len(meetings), 10):
        batch = [m["id"] for m in meetings[i:i + 10]]
        try:
            got = pod.connectors.execute(
                data.app, data.get_op, {"meeting_ids": batch},
                account_id=account_id).to_dict()
        except Exception as exc:
            res.errors.append(f"notes for {len(batch)} meetings: {str(exc)[:140]}")
            continue
        for d in _parse_meetings(_resp_text(got)):
            body = d.get("inner", "")
            # drop the participant block; the notes are what matter
            body = _PARTS_RE.sub("", body).strip()
            if body:
                notes[d["id"]] = unescape(body)

    interactions: list[dict] = []
    for m in meetings:
        mid = m["id"]
        body = notes.get(mid, "")
        if not body:
            continue

        attendees = [
            {"email": em, "role": "attendee"}
            for em in m["emails"] if em and em != me
        ]
        counterpart = attendees[0]["email"] if len(attendees) == 1 else ""

        interactions.append({
            "kind": "meeting",
            "source": "granola",
            "external_id": f"granola:{mid}",
            "thread_ref": f"granola:{mid}",
            "occurred_at": _parse_when(m["date"]),
            "subject": m["title"],
            "body": body[:20000],
            "direction": "internal",
            "addressed_to_me": True,
            "person_email": counterpart,
            "company_domain": counterpart.split("@")[-1] if "@" in counterpart else None,
            "participants": attendees,
        })

    res.shaped = len(interactions)
    for i in range(0, len(interactions), data.batch_size):
        chunk = interactions[i:i + data.batch_size]
        try:
            out = pod.functions.run("record_interaction", {"interactions": chunk}).to_dict()
        except Exception as exc:
            res.errors.append(f"batch at {i}: {str(exc)[:150]}")
            continue
        d = out.get("output_data") or {}
        res.recorded += d.get("created", 0)
        res.skipped_duplicate += d.get("skipped_duplicate", 0)
        res.files_written += d.get("files_written", 0)

    return res
