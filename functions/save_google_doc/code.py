#input_type_name: SaveGoogleDocInput
#output_type_name: SaveGoogleDocResult

#function_name: save_google_doc

import re

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# A document card's "Save to Google Docs". Creates a new doc in the person's own Drive
# from the markdown Lem wrote and hands back its URL; the app stores it on the
# deliverable so the card shows "Open in Google Docs" from then on. Run only from the
# person's click. If Google Docs is not connected, says so plainly — the app then offers
# the one-click connect.


class SaveGoogleDocInput(BaseModel):
    title: str
    markdown: str


class SaveGoogleDocResult(BaseModel):
    saved: bool = False
    url: str = ""
    document_id: str = ""
    needs_connect: bool = False
    error: str = ""


def _find_id(obj) -> str:
    if isinstance(obj, dict):
        for k in ("documentId", "document_id", "id"):
            v = obj.get(k)
            if isinstance(v, str) and len(v) > 20:
                return v
        for v in obj.values():
            got = _find_id(v)
            if got:
                return got
    return ""


async def save_google_doc(ctx: FunctionContext, data: SaveGoogleDocInput) -> SaveGoogleDocResult:
    pod = Pod.from_env()
    res = SaveGoogleDocResult()
    title = (data.title or "Untitled").strip()[:180]
    body = data.markdown or ""
    # One create, never two: the first version tried a second method whenever it could
    # not read the id back, and made a duplicate doc on every click.
    try:
        out = pod.connectors.execute("google_docs", "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN",
                                     {"title": title, "markdown_text": body})
        out = out.to_dict() if hasattr(out, "to_dict") else out
    except Exception as exc:
        msg = str(exc)
        if re.search(r"not (installed|connected)|no (connected )?account|CONNECTOR_NOT|ACCOUNT_NOT", msg, re.I):
            res.needs_connect = True
            res.error = "Google Docs is not connected yet"
        else:
            res.error = f"Google Docs refused it: {msg[:200]}"
        return res
    doc_id = _find_id(out)
    if not doc_id:
        m = re.search(r"docs\.google\.com/document/d/([A-Za-z0-9_-]{20,})", str(out))
        doc_id = m.group(1) if m else ""
    if not doc_id:
        res.error = "The doc was created but Google did not say where — look for it in your Drive by its title."
        return res
    res.saved = True
    res.document_id = doc_id
    res.url = f"https://docs.google.com/document/d/{doc_id}/edit"
    return res
