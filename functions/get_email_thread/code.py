#input_type_name: GetThreadInput
#output_type_name: GetThreadResult

#function_name: get_email_thread

import re
from datetime import datetime, timezone
from email.utils import parseaddr

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# Read one Gmail conversation so the app can show it beside the Feed — the actual
# messages, oldest first, with quoted history stripped so each message shows only what
# that person wrote. Read-only: never marks read, never labels, never sends.


class GetThreadInput(BaseModel):
    thread_id: str


class Attachment(BaseModel):
    filename: str = ""
    mime: str = ""
    attachment_id: str = ""


class ThreadMessage(BaseModel):
    id: str = ""
    from_name: str = ""
    from_email: str = ""
    to: list[str] = []
    cc: list[str] = []
    date: str = ""               # ISO, UTC
    subject: str = ""
    body: str = ""               # just this message, quotes stripped
    mine: bool = False
    attachments: list[Attachment] = []


class GetThreadResult(BaseModel):
    subject: str = ""
    messages: list[ThreadMessage] = []
    error: str = ""


_QUOTE = re.compile(
    r"(\n\s*On .{3,160}wrote:\s*\n|\n\s*-{2,}\s*Original Message\s*-{2,}|\n\s*From: .+\n\s*Sent: |\n>)",
    re.I,
)


def _strip(text: str) -> str:
    t = (text or "").replace("\r\n", "\n")
    m = _QUOTE.search("\n" + t)
    if m and m.start() > 20:
        t = t[: m.start() - 1]
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _addrs(raw: str) -> list[str]:
    out = []
    for part in re.split(r"[,;]", raw or ""):
        e = parseaddr(part)[1].lower()
        if e and e not in out:
            out.append(e)
    return out


def _iso(ts) -> str:
    raw = str(ts or "").strip()
    if not raw:
        return ""
    if raw.isdigit():
        return datetime.fromtimestamp(int(raw) / (1000 if len(raw) > 10 else 1), tz=timezone.utc).isoformat()
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    except ValueError:
        return raw


async def get_email_thread(ctx: FunctionContext, data: GetThreadInput) -> GetThreadResult:
    pod = Pod.from_env()
    res = GetThreadResult()
    tid = (data.thread_id or "").strip()
    if not re.fullmatch(r"[0-9a-f]{10,24}", tid):
        res.error = "not an email conversation"
        return res
    try:
        resp = pod.connectors.execute("gmail", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", {"thread_id": tid})
        resp = resp.to_dict() if hasattr(resp, "to_dict") else resp
    except Exception as exc:
        res.error = f"Gmail would not open it: {str(exc)[:160]}"
        return res

    r = resp.get("result", resp) if isinstance(resp, dict) else {}
    body = r.get("data", r) if isinstance(r, dict) else {}
    msgs = (body.get("messages") if isinstance(body, dict) else None) or r.get("messages") or []

    for m in msgs:
        name, email = parseaddr(m.get("sender") or m.get("from") or "")
        labels = m.get("labelIds") or []
        text = m.get("messageText") or (m.get("preview") or {}).get("body") or m.get("snippet") or ""
        res.messages.append(ThreadMessage(
            id=str(m.get("messageId") or m.get("id") or ""),
            from_name=(name or email.split("@")[0]).strip('" '),
            from_email=email.lower(),
            to=_addrs(m.get("to") or ""),
            cc=_addrs(m.get("cc") or ""),
            date=_iso(m.get("messageTimestamp") or m.get("internalDate") or m.get("date")),
            subject=(m.get("subject") or "").strip(),
            body=_strip(text),
            mine="SENT" in labels,
            attachments=[
                Attachment(filename=a.get("filename") or "file", mime=a.get("mimeType") or "",
                           attachment_id=a.get("attachmentId") or "")
                for a in (m.get("attachmentList") or [])
                if a.get("attachmentId") and a.get("filename")
            ],
        ))
    res.messages.sort(key=lambda x: x.date)
    res.subject = next((x.subject for x in res.messages if x.subject), "")
    if not res.messages:
        res.error = "No messages came back for this conversation."
    return res
