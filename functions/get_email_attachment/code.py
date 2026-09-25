#input_type_name: GetAttachmentInput
#output_type_name: GetAttachmentResult

#function_name: get_email_attachment

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# One attachment from a Gmail message, so the thread beside the Feed can open it.
# Read-only. Returns the bytes as base64; the app turns them into a file to open.

MAX_BYTES = 12 * 1024 * 1024


class GetAttachmentInput(BaseModel):
    message_id: str
    attachment_id: str
    file_name: str = "attachment"


class GetAttachmentResult(BaseModel):
    content_base64: str = ""
    mime: str = ""
    file_name: str = ""
    error: str = ""


def _dig(o, key):
    if isinstance(o, dict):
        if key in o and o[key]:
            return o[key]
        for v in o.values():
            r = _dig(v, key)
            if r:
                return r
    return None


async def get_email_attachment(ctx: FunctionContext, data: GetAttachmentInput) -> GetAttachmentResult:
    pod = Pod.from_env()
    res = GetAttachmentResult(file_name=data.file_name)
    try:
        out = pod.connectors.execute("gmail", "GMAIL_GET_ATTACHMENT", {
            "message_id": data.message_id, "attachment_id": data.attachment_id, "file_name": data.file_name,
        })
        out = out.to_dict() if hasattr(out, "to_dict") else out
    except Exception as exc:
        res.error = f"Gmail would not open it: {str(exc)[:160]}"
        return res
    b64 = _dig(out, "content_base64") or ""
    if not b64:
        res.error = "Gmail returned no file."
        return res
    if len(b64) * 3 // 4 > MAX_BYTES:
        res.error = "Too large to open here — open it in Gmail."
        return res
    res.content_base64 = b64
    res.mime = _dig(out, "mimetype") or _dig(out, "mime_type") or ""
    return res
