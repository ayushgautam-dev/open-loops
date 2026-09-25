#input_type_name: SendInviteInput
#output_type_name: SendInviteResult

#function_name: send_invite

import re
from datetime import datetime

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# The meeting card's "Send invite". Like send_draft, this is only ever triggered by the
# person's own click, and it reports failure honestly instead of pretending. It books one
# event on their primary calendar with a Meet link and emails the invite to the guests.
# The app passes everything it shows on screen — an app-invoked function cannot read the
# person's RLS rows — and does its own bookkeeping after a success.


class SendInviteInput(BaseModel):
    title: str
    start: str                    # local wall-clock time, "YYYY-MM-DDTHH:MM" (seconds optional)
    duration_min: int = 30
    timezone: str = "Asia/Kolkata"
    attendees: list[str] = []
    description: str | None = None


class SendInviteResult(BaseModel):
    sent: bool = False
    event_id: str = ""
    link: str = ""
    error: str = ""


async def send_invite(ctx: FunctionContext, data: SendInviteInput) -> SendInviteResult:
    pod = Pod.from_env()
    res = SendInviteResult()

    guests = []
    for a in data.attendees:
        a = (a or "").strip().lower()
        if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", a) and a not in guests:
            guests.append(a)
    if not guests:
        res.error = "nobody to invite"
        return res

    raw = data.start.strip().replace("Z", "")
    raw = re.sub(r"[+-]\d\d:\d\d$", "", raw)
    try:
        start = datetime.fromisoformat(raw)
    except ValueError:
        res.error = f"could not read the start time '{data.start}'"
        return res

    mins = max(5, min(int(data.duration_min or 30), 8 * 60))
    args = {
        "calendar_id": "primary",
        "summary": data.title.strip() or "Meeting",
        "start_datetime": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "timezone": data.timezone or "Asia/Kolkata",
        "event_duration_hour": mins // 60,
        "event_duration_minutes": mins % 60,
        "attendees": guests,
        "create_meeting_room": True,
        "send_updates": "all",
    }
    if data.description:
        args["description"] = data.description
    try:
        out = pod.connectors.execute("google_calendar", "GOOGLECALENDAR_CREATE_EVENT", args)
    except Exception as exc:
        res.error = f"Calendar refused the invite: {str(exc)[:200]}"
        return res

    body = out if isinstance(out, dict) else {}
    ev = body.get("data") or body.get("response_data") or body
    if isinstance(ev, dict) and isinstance(ev.get("response_data"), dict):
        ev = ev["response_data"]
    res.sent = True
    res.event_id = str((ev or {}).get("id") or "")
    res.link = str((ev or {}).get("hangoutLink") or (ev or {}).get("htmlLink") or "")
    return res
