#input_type_name: FetchRecentEmailsInput
#output_type_name: FetchRecentEmailsResult
#function_name: fetch_recent_emails

import re
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# Deterministic Gmail pull. Paginates GMAIL_FETCH_EMAILS over the last N days,
# groups messages into threads, and returns a compact per-thread digest that the
# loop_extractor agent reasons over. No judgment here — just fetch + shape.


class FetchRecentEmailsInput(BaseModel):
    days: int = 30
    max_messages: int = 220          # hard cap on how many messages we pull
    max_threads: int = 55            # keep the most-recent N threads in the digest
    messages_per_thread: int = 4     # last M messages kept per thread
    snippet_chars: int = 420
    query: str | None = None         # override the default Gmail search query


class DigestMessage(BaseModel):
    from_name: str
    from_email: str
    direction: str        # "sent" (from me) | "recv" (to me)
    # How the founder is on this message. "to" = addressed directly, "cc" = copied for
    # visibility, "none" = not a recipient at all. The extractor needs this to tell an
    # ask aimed at the founder from one aimed at a colleague they were merely copied on.
    my_role: str
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    date: str             # YYYY-MM-DD
    snippet: str


class DigestThread(BaseModel):
    thread_id: str
    subject: str
    participants: list[str]
    message_count: int
    last_date: str
    last_direction: str
    messages: list[DigestMessage]


class FetchRecentEmailsResult(BaseModel):
    my_email: str
    thread_count: int
    message_count: int
    threads: list[DigestThread]


def _addr(raw: str) -> tuple[str, str]:
    """Split 'Name <a@b.com>' -> ('Name', 'a@b.com')."""
    raw = (raw or "").strip()
    m = re.match(r"^\s*(.*?)\s*<([^>]+)>\s*$", raw)
    if m:
        name = m.group(1).strip().strip('"')
        email = m.group(2).strip().lower()
        return (name or email.split("@")[0], email)
    if "@" in raw:
        return (raw.split("@")[0], raw.lower())
    return (raw, "")


def _to_date(ts: str) -> str:
    ts = (ts or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(ts, fmt).astimezone(timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            pass
    return (ts[:10] if len(ts) >= 10 else "")


async def fetch_recent_emails(ctx: FunctionContext, data: FetchRecentEmailsInput) -> FetchRecentEmailsResult:
    pod = Pod.from_env()
    my_email = (ctx.user_email or "").lower()

    query = data.query or (
        f"newer_than:{data.days}d -in:spam -in:trash "
        "-category:promotions -category:social -category:forums"
    )

    # ---- paginate ----
    raw_messages: list[dict] = []
    page_token = None
    guard = 0
    while len(raw_messages) < data.max_messages and guard < 40:
        guard += 1
        payload = {
            "query": query,
            "max_results": min(50, data.max_messages - len(raw_messages)),
            "verbose": True,
            "include_spam_trash": False,
        }
        if page_token:
            payload["page_token"] = page_token
        resp = pod.connectors.execute("gmail", "GMAIL_FETCH_EMAILS", payload).to_dict()
        r = resp.get("result", resp)
        # composio may nest under "data"; be defensive
        body = r.get("data", r) if isinstance(r, dict) else {}
        msgs = body.get("messages") or r.get("messages") or []
        raw_messages.extend(msgs)
        page_token = body.get("nextPageToken") or r.get("nextPageToken")
        if not page_token or not msgs:
            break

    # ---- group into threads ----
    threads: dict[str, dict] = {}
    for m in raw_messages:
        tid = m.get("threadId") or m.get("messageId")
        if not tid:
            continue
        from_name, from_email = _addr(m.get("sender", ""))
        labels = m.get("labelIds") or []
        direction = "sent" if ("SENT" in labels or (my_email and from_email == my_email)) else "recv"
        text = (m.get("messageText") or (m.get("preview") or {}).get("body") or "").strip()
        text = re.sub(r"\s+", " ", text)[: data.snippet_chars]

        to_addrs = [a for a in (_addr(x)[1] for x in re.split(r"[,;]", m.get("to", "") or "")) if a]
        cc_addrs = [a for a in (_addr(x)[1] for x in re.split(r"[,;]", m.get("cc", "") or "")) if a]
        if my_email and my_email in to_addrs:
            my_role = "to"
        elif my_email and my_email in cc_addrs:
            my_role = "cc"
        else:
            my_role = "none"

        dm = {
            "from_name": from_name,
            "from_email": from_email,
            "direction": direction,
            "my_role": my_role,
            "to": to_addrs[:8],
            "cc": cc_addrs[:8],
            "date": _to_date(m.get("messageTimestamp", "")),
            "snippet": text,
        }
        t = threads.setdefault(tid, {
            "thread_id": tid,
            "subject": (m.get("subject") or "(no subject)").strip(),
            "messages": [],
            "participants": set(),
        })
        t["messages"].append(dm)
        # counterparties = everyone on the thread who isn't me (from `sender` + `to`)
        if from_email and from_email != my_email:
            t["participants"].add(f"{from_name} <{from_email}>")
        for rcpt in re.split(r"[,;]", (m.get("to", "") or "") + "," + (m.get("cc", "") or "")):
            rn, re_ = _addr(rcpt)
            if re_ and re_ != my_email:
                t["participants"].add(f"{rn} <{re_}>")

    # ---- shape + trim ----
    shaped: list[DigestThread] = []
    for t in threads.values():
        msgs = sorted(t["messages"], key=lambda x: x["date"])
        last = msgs[-1] if msgs else {"date": "", "direction": "recv"}
        kept = msgs[-data.messages_per_thread:]
        shaped.append(DigestThread(
            thread_id=t["thread_id"],
            subject=t["subject"],
            participants=sorted(t["participants"])[:6],
            message_count=len(msgs),
            last_date=last["date"],
            last_direction=last["direction"],
            messages=[DigestMessage(**k) for k in kept],
        ))

    shaped.sort(key=lambda x: x.last_date, reverse=True)
    shaped = shaped[: data.max_threads]

    return FetchRecentEmailsResult(
        my_email=my_email,
        thread_count=len(shaped),
        message_count=len(raw_messages),
        threads=shaped,
    )
