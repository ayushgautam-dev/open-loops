#input_type_name: FetchPersonHistoryInput
#output_type_name: FetchPersonHistoryResult
#function_name: fetch_person_history

import re
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# Everything the founder has ever exchanged with one person, oldest first.
#
# The 30-day digest that drives loop extraction is deliberately shallow — it answers
# "what is open right now". This answers the other question: "who is this person and
# what is the story so far", which is what makes a relationship summary worth reading.
# A thread that started in January matters even though nothing in it is outstanding.
#
# Loop extraction must NOT run off this: old obligations are almost always already
# resolved. `recent_cutoff_days` marks which messages are recent enough to be
# actionable, so the caller can build history from everything and loops from a little.


class FetchPersonHistoryInput(BaseModel):
    email: str
    max_messages: int = 120
    snippet_chars: int = 500
    recent_cutoff_days: int = 21     # only messages newer than this can open a loop


class HistoryMessage(BaseModel):
    thread_id: str
    subject: str
    direction: str          # "sent" (from the founder) | "recv"
    my_role: str            # to | cc | none
    date: str               # YYYY-MM-DD
    is_recent: bool
    snippet: str


class FetchPersonHistoryResult(BaseModel):
    email: str
    my_email: str
    message_count: int
    thread_count: int
    first_contact: str = ""
    last_contact: str = ""
    # True when the founder has never once written to them: the signature of cold
    # inbound, and the strongest single reason to ignore a sender entirely.
    never_replied: bool = False
    inbound_only_streak: int = 0
    recent_message_count: int = 0
    messages: list[HistoryMessage] = Field(default_factory=list)
    note: str = ""


def _addr(raw: str) -> tuple[str, str]:
    raw = (raw or "").strip()
    m = re.match(r"^\s*(.*?)\s*<([^>]+)>\s*$", raw)
    if m:
        return (m.group(1).strip().strip('"') or m.group(2).split("@")[0], m.group(2).strip().lower())
    if "@" in raw:
        return (raw.split("@")[0], raw.strip().lower())
    return (raw, "")


def _to_date(ts: str) -> str:
    ts = (ts or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(ts, fmt).astimezone(timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            pass
    return ts[:10] if len(ts) >= 10 else ""


async def fetch_person_history(
    ctx: FunctionContext, data: FetchPersonHistoryInput
) -> FetchPersonHistoryResult:
    pod = Pod.from_env()
    my_email = (ctx.user_email or "").lower()
    target = data.email.strip().lower()
    if "@" not in target:
        return FetchPersonHistoryResult(
            email=target, my_email=my_email, message_count=0, thread_count=0,
            note="Not an email address.",
        )

    # Everything either direction, all time. No date filter — that is the whole point.
    query = f"(from:{target} OR to:{target} OR cc:{target}) -in:spam -in:trash"

    raw: list[dict] = []
    page_token, guard = None, 0
    while len(raw) < data.max_messages and guard < 20:
        guard += 1
        payload = {
            "query": query,
            "max_results": min(50, data.max_messages - len(raw)),
            "verbose": True,
            "include_spam_trash": False,
        }
        if page_token:
            payload["page_token"] = page_token
        try:
            resp = pod.connectors.execute("gmail", "GMAIL_FETCH_EMAILS", payload).to_dict()
        except Exception as exc:
            return FetchPersonHistoryResult(
                email=target, my_email=my_email, message_count=0, thread_count=0,
                note=f"Gmail read failed: {type(exc).__name__}",
            )
        r = resp.get("result", resp)
        body = r.get("data", r) if isinstance(r, dict) else {}
        msgs = body.get("messages") or r.get("messages") or []
        raw.extend(msgs)
        page_token = body.get("nextPageToken") or r.get("nextPageToken")
        if not page_token or not msgs:
            break

    cutoff = (
        datetime.now(timezone.utc).timestamp() - data.recent_cutoff_days * 86400
    )

    shaped: list[HistoryMessage] = []
    threads: set[str] = set()
    for m in raw:
        _, from_email = _addr(m.get("sender", ""))
        labels = m.get("labelIds") or []
        direction = "sent" if ("SENT" in labels or (my_email and from_email == my_email)) else "recv"

        to_addrs = [a for a in (_addr(x)[1] for x in re.split(r"[,;]", m.get("to", "") or "")) if a]
        cc_addrs = [a for a in (_addr(x)[1] for x in re.split(r"[,;]", m.get("cc", "") or "")) if a]
        my_role = "to" if my_email in to_addrs else "cc" if my_email in cc_addrs else "none"

        date = _to_date(m.get("messageTimestamp", ""))
        try:
            is_recent = datetime.strptime(date, "%Y-%m-%d").replace(
                tzinfo=timezone.utc).timestamp() >= cutoff
        except Exception:
            is_recent = False

        text = (m.get("messageText") or (m.get("preview") or {}).get("body") or "").strip()
        tid = m.get("threadId") or m.get("messageId") or ""
        threads.add(tid)
        shaped.append(HistoryMessage(
            thread_id=tid,
            subject=(m.get("subject") or "(no subject)").strip()[:160],
            direction=direction,
            my_role=my_role,
            date=date,
            is_recent=is_recent,
            snippet=re.sub(r"\s+", " ", text)[: data.snippet_chars],
        ))

    shaped.sort(key=lambda x: x.date)          # oldest first: this is a story

    sent_count = sum(1 for m in shaped if m.direction == "sent")
    # How many inbound messages have piled up since the founder last wrote anything.
    streak = 0
    for m in reversed(shaped):
        if m.direction == "sent":
            break
        streak += 1

    return FetchPersonHistoryResult(
        email=target,
        my_email=my_email,
        message_count=len(shaped),
        thread_count=len(threads),
        first_contact=shaped[0].date if shaped else "",
        last_contact=shaped[-1].date if shaped else "",
        never_replied=sent_count == 0 and len(shaped) > 0,
        inbound_only_streak=streak,
        recent_message_count=sum(1 for m in shaped if m.is_recent),
        messages=shaped,
        note="" if shaped else "No mail found with this address.",
    )
