#input_type_name: ShareDocumentInput
#output_type_name: ShareDocumentResult

#function_name: share_document

import re

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# Sending a document the professional way while email attachments are not available
# through the connector: the document becomes a real Google Doc in the sender's Drive and
# is shared with exactly the people it is going to (view access, by email — never "anyone
# with the link"). The email then carries a link those people can actually open.
# Run only from the person's own Send.


class ShareDocumentInput(BaseModel):
    title: str
    markdown: str = ""
    doc_url: str | None = None          # an existing Google Doc to share instead of creating one
    recipients: list[str] = []


class ShareDocumentResult(BaseModel):
    url: str = ""
    document_id: str = ""
    shared_with: list[str] = []
    needs_connect: str = ""             # "google_docs" | "google_drive" when one is missing
    error: str = ""


_NOT_CONNECTED = re.compile(r"not (installed|connected)|no (connected )?account|CONNECTOR_NOT|ACCOUNT_NOT", re.I)


def _dict(o):
    return o.to_dict() if hasattr(o, "to_dict") else o


def _find_id(o) -> str:
    if isinstance(o, dict):
        for k in ("documentId", "document_id", "id"):
            v = o.get(k)
            if isinstance(v, str) and len(v) > 20:
                return v
        for v in o.values():
            got = _find_id(v)
            if got:
                return got
    m = re.search(r"/document/d/([A-Za-z0-9_-]{20,})", str(o))
    return m.group(1) if m else ""


async def share_document(ctx: FunctionContext, data: ShareDocumentInput) -> ShareDocumentResult:
    pod = Pod.from_env()
    res = ShareDocumentResult()
    people = []
    for r in data.recipients:
        r = (r or "").strip().lower()
        if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", r) and r not in people:
            people.append(r)
    if not people:
        res.error = "nobody to share with"
        return res

    doc_id = _find_id(data.doc_url or "")
    if not doc_id:
        try:
            out = _dict(pod.connectors.execute("google_docs", "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
                                               {"title": data.title.strip()[:180] or "Document",
                                                "markdown_text": data.markdown or ""}))
        except Exception as exc:
            if _NOT_CONNECTED.search(str(exc)):
                res.needs_connect = "google_docs"
            res.error = f"Google Docs refused it: {str(exc)[:160]}"
            return res
        doc_id = _find_id(out)
        if not doc_id:
            res.error = "The doc was created but Google did not return its id."
            return res
    res.document_id = doc_id
    res.url = f"https://docs.google.com/document/d/{doc_id}/edit"

    last = ""
    for email in people:
        shared = False
        # Our own email carries the link, so Google's "shared with you" notice is switched
        # off — the recipient should get one message, not two.
        for op, args in (
            ("GOOGLEDRIVE_CREATE_PERMISSION",
             {"file_id": doc_id, "role": "reader", "type": "user", "email_address": email,
              "send_notification_email": False}),
            ("GOOGLEDRIVE_ADD_FILE_SHARING_PREFERENCE",
             {"file_id": doc_id, "role": "reader", "type": "user", "email_address": email}),
        ):
            try:
                pod.connectors.execute("google_drive", op, args)
                shared = True
                break
            except Exception as exc:
                last = str(exc)
                if _NOT_CONNECTED.search(last):
                    res.needs_connect = "google_drive"
                    res.error = "Google Drive is not connected, so the document could not be shared."
                    return res
        if shared:
            res.shared_with.append(email)
    if len(res.shared_with) < len(people):
        res.error = f"Could not share with everyone: {last[:160]}"
    return res
