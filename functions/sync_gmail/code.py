#input_type_name: SyncGmailInput
#output_type_name: SyncGmailResult
#function_name: sync_gmail

# Gmail -> the interaction ledger. This function talks to Gmail, shapes what it
# finds into normalised interactions, and hands them to `record_interaction`.
#
# It forms no opinion about content: no keyword filters, no "is this a newsletter"
# guesses, no obligation detection. Whether a message means anything is decided
# later by the extractor, which reads the ledger. All this does is parse and pass on.
#
# Unlike the older fetch_recent_emails, the body is NOT truncated to a snippet —
# the whole text is kept, because the stored copy is what the second brain searches
# and what a better extractor will re-read later.

import re
from datetime import datetime, timezone
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class SyncGmailInput(BaseModel):
    days: int = 30
    max_messages: int = 200
    query: str | None = None
    message_ids: list[str] | None = None     # set by the webhook path for a single new mail
    body_chars: int = 20000
    batch_size: int = 15


class SyncGmailResult(BaseModel):
    fetched: int = 0
    shaped: int = 0
    recorded: int = 0
    skipped_duplicate: int = 0
    files_written: int = 0
    errors: list[str] = []


def _addr(raw: str) -> tuple[str, str]:
    raw = (raw or "").strip()
    m = re.match(r"^\s*(.*?)\s*<([^>]+)>\s*$", raw)
    if m:
        return (m.group(1).strip().strip('"') or m.group(2).split("@")[0], m.group(2).strip().lower())
    if "@" in raw:
        return (raw.split("@")[0], raw.strip().lower())
    return (raw, "")


def _split(raw: str) -> list[str]:
    return [a for a in (_addr(x)[1] for x in re.split(r"[,;]", raw or "")) if a]


def _iso(ts: str) -> str:
    raw = (ts or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    if len(raw) >= 10:
        try:
            return datetime.strptime(raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return datetime.now(timezone.utc).isoformat()


async def sync_gmail(ctx: FunctionContext, data: SyncGmailInput) -> SyncGmailResult:
    pod = Pod.from_env()
    res = SyncGmailResult()
    me = (ctx.user_email or "").lower()

    query = data.query or (
        f"newer_than:{data.days}d -in:spam -in:trash "
        "-category:promotions -category:social -category:forums"
    )

    raw: list[dict] = []
    if data.message_ids:
        for mid in data.message_ids[:50]:
            try:
                r = pod.connectors.execute(
                    "gmail", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
                    {"message_id": mid, "format": "full"}).to_dict()
                r = r.get("result", r)
                raw.append(r.get("data", r))
            except Exception as exc:
                res.errors.append(f"{mid}: {exc}")
    else:
        page_token, guard = None, 0
        while len(raw) < data.max_messages and guard < 40:
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
                res.errors.append(str(exc))
                break
            r = resp.get("result", resp)
            body = r.get("data", r) if isinstance(r, dict) else {}
            msgs = body.get("messages") or r.get("messages") or []
            raw.extend(msgs)
            page_token = body.get("nextPageToken") or r.get("nextPageToken")
            if not page_token or not msgs:
                break

    res.fetched = len(raw)

    interactions: list[dict] = []
    for m in raw:
        if not isinstance(m, dict):
            continue
        gmail_id = m.get("messageId") or m.get("id")
        # RFC Message-ID is stable across mailboxes; the Gmail id is only stable here.
        ext = (m.get("rfc822MessageId") or m.get("messageId") or gmail_id or "").strip()
        if not ext:
            continue

        from_name, from_email = _addr(m.get("sender", ""))
        to_addrs, cc_addrs = _split(m.get("to", "")), _split(m.get("cc", ""))
        labels = m.get("labelIds") or []
        outbound = "SENT" in labels or (me and from_email == me)

        # Who is this with? For mail I sent, the counterparty is the first recipient.
        counterpart = ""
        if outbound:
            counterpart = next((a for a in to_addrs if a != me), "")
        else:
            counterpart = from_email if from_email != me else ""

        body_text = (m.get("messageText") or (m.get("preview") or {}).get("body") or "").strip()

        participants = [{"name": from_name, "email": from_email, "role": "from"}]
        participants += [{"email": a, "role": "to"} for a in to_addrs[:12]]
        participants += [{"email": a, "role": "cc"} for a in cc_addrs[:12]]

        interactions.append({
            "kind": "email",
            "source": "gmail",
            "external_id": ext,
            "thread_ref": m.get("threadId") or ext,
            "occurred_at": _iso(m.get("messageTimestamp", "")),
            "subject": (m.get("subject") or "(no subject)").strip(),
            "body": body_text[: data.body_chars],
            "direction": "outbound" if outbound else "inbound",
            # Copied-in threads become context, never obligations. The extractor is
            # told to respect this flag rather than re-deriving it.
            "addressed_to_me": bool(outbound or (me and me in to_addrs) or not me),
            "person_email": counterpart,
            "company_domain": counterpart.split("@")[-1] if "@" in counterpart else None,
            "participants": participants,
        })

    res.shaped = len(interactions)
    # Chunked: each interaction carries a full body and triggers a file write, so a
    # whole 30-day backfill in one call times out. Batches keep each call small and
    # let a partial failure keep the work already done.
    for i in range(0, len(interactions), data.batch_size):
        chunk = interactions[i:i + data.batch_size]
        try:
            out = pod.functions.run(
                "record_interaction", {"interactions": chunk}).to_dict()
        except Exception as exc:
            res.errors.append(f"batch at {i} failed: {str(exc)[:160]}")
            continue
        d = out.get("output_data") or {}
        res.recorded += d.get("created", 0)
        res.skipped_duplicate += d.get("skipped_duplicate", 0)
        res.files_written += d.get("files_written", 0)
        res.errors += (d.get("errors") or [])[:3]

    return res
