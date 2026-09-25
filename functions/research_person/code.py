#input_type_name: ResearchPersonInput
#output_type_name: ResearchPersonResult
#function_name: research_person

# Who is this person, before you meet them for the first time.
#
# Runs only for someone OUTSIDE your own company that you have not really met yet
# — the brief calls it automatically in that one case. Two lookups, both optional:
#   * the person, from their LinkedIn URL
#   * their company, from the domain in their email address
# The prose it writes lands on `people.research` and is shown in the morning brief.
#
# The key lives in `settings` under `research_api_key` and is read here only. The
# endpoint and field names are also settings, so they can be corrected without a
# redeploy if the provider's shape differs from the default below.

import json
import urllib.error
import urllib.request

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

DEFAULT_BASE = "https://api.monid.ai"
DEFAULT_PERSON_PATH = "/v1/enrich/person"
DEFAULT_COMPANY_PATH = "/v1/enrich/company"
TIMEOUT = 25

PERSONAL_DOMAINS = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
}


class ResearchPersonInput(BaseModel):
    person_id: str
    force: bool = False          # re-run even when research already exists


class ResearchPersonResult(BaseModel):
    ok: bool = False
    person: str = ""
    wrote: bool = False
    skipped_reason: str = ""
    research: str = ""
    errors: list[str] = []


def _setting(pod: Pod, key: str, default: str = "") -> str:
    try:
        rows = pod.query(
            f"select value from settings where key='{key}' limit 1"
        ).to_dict()["items"]
        return (rows[0].get("value") or "").strip() if rows else default
    except Exception:
        return default


def _web_lines(pod: Pod, name: str, company: str, res) -> list[str]:
    """What we can say about somebody with no research key at all.

    Lemma's own web search needs no credential, so skipping the key costs a
    sharper answer, not the feature. It returns prose and links rather than
    structured fields, so this is plainly worse than the provider — but a sketch
    with sources beats an empty card, and nobody has to sign up for anything to
    get it.
    """
    out: list[str] = []
    plans = []
    if name:
        plans.append((f"{name} {company}".strip(), "### The person"))
    if company:
        plans.append((f"{company} company what they do", f"### {company}"))

    for query, heading in plans:
        try:
            found = pod.tools.web_search(query, max_results=4).to_dict()
        except Exception as exc:
            res.errors.append(f"web search: {str(exc)[:120]}")
            continue
        if found.get("error"):
            res.errors.append(f"web search: {str(found['error'])[:120]}")
            continue
        picked: list[str] = []
        for item in (found.get("results") or [])[:4]:
            if not isinstance(item, dict):
                continue
            snippet = (item.get("snippet") or item.get("title") or "").strip()
            if not snippet:
                continue
            url = (item.get("url") or "").strip()
            picked.append(f"- {snippet[:240]}" + (f" ([source]({url}))" if url else ""))
        if picked:
            out.append(heading)
            out.extend(picked)
    return out


def _post(url: str, key: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode() or "{}")


def _flatten(obj, depth: int = 0) -> list[str]:
    """Pull readable 'Label: value' lines out of whatever shape came back."""
    out: list[str] = []
    if depth > 3:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.startswith("_") or k in {"id", "raw", "request_id"}:
                continue
            if isinstance(v, (str, int, float)) and str(v).strip():
                label = k.replace("_", " ").strip().capitalize()
                text = str(v).strip()
                if len(text) > 400:
                    text = text[:400] + "…"
                out.append(f"**{label}:** {text}")
            elif isinstance(v, (dict, list)):
                out.extend(_flatten(v, depth + 1))
    elif isinstance(obj, list):
        for item in obj[:5]:
            out.extend(_flatten(item, depth + 1))
    return out


async def research_person(ctx: FunctionContext, data: ResearchPersonInput) -> ResearchPersonResult:
    pod = Pod.from_env()
    res = ResearchPersonResult()

    rows = pod.query(
        "select p.id, p.name, p.email, p.role, p.linkedin_url, p.research, "
        "c.name as company_name, c.domain as company_domain, c.id as company_id "
        "from people p left join companies c on c.id = p.company_id "
        f"where p.id = '{data.person_id}' limit 1"
    ).to_dict()["items"]
    if not rows:
        res.skipped_reason = "no such person"
        return res
    p = rows[0]
    res.person = p.get("name") or ""

    if p.get("research") and not data.force:
        res.ok = True
        res.research = p["research"]
        res.skipped_reason = "already researched"
        return res

    # No key is a normal state, not a failure: fall back to web search below.
    key = _setting(pod, "research_api_key")

    base = _setting(pod, "research_api_base", DEFAULT_BASE).rstrip("/")
    person_path = _setting(pod, "research_person_path", DEFAULT_PERSON_PATH)
    company_path = _setting(pod, "research_company_path", DEFAULT_COMPANY_PATH)

    email = (p.get("email") or "").strip()
    domain = (p.get("company_domain") or "").strip().lower()
    if not domain and "@" in email:
        cand = email.split("@")[1].lower()
        if cand not in PERSONAL_DOMAINS:
            domain = cand

    lines: list[str] = []

    # 1. the person, from their LinkedIn URL when we have one
    li = (p.get("linkedin_url") or "").strip()
    if key and li:
        try:
            body = _post(f"{base}{person_path}", key, {"linkedin_url": li, "email": email})
            found = _flatten(body.get("data", body))
            if found:
                lines.append("### The person")
                lines.extend(found[:8])
        except urllib.error.HTTPError as exc:
            res.errors.append(f"person lookup {exc.code}")
        except Exception as exc:
            res.errors.append(f"person lookup: {str(exc)[:120]}")

    # 2. their company, from the email domain — this is the half that works
    #    without a LinkedIn URL, so it carries the card on its own.
    if key and domain:
        try:
            body = _post(f"{base}{company_path}", key, {"domain": domain})
            found = _flatten(body.get("data", body))
            if found:
                lines.append(f"### {p.get('company_name') or domain}")
                lines.extend(found[:8])
        except urllib.error.HTTPError as exc:
            res.errors.append(f"company lookup {exc.code}")
        except Exception as exc:
            res.errors.append(f"company lookup: {str(exc)[:120]}")

    if not key:
        lines.extend(_web_lines(
            pod, p.get("name") or "", p.get("company_name") or domain, res))

    if not lines:
        res.skipped_reason = "nothing returned" if not res.errors else "lookup failed"
        return res

    research = "\n".join(lines)[:4000]
    pod.records.update("people", data.person_id, {"research": research})
    # The company copy is worth keeping too — the next person there gets it free.
    if domain and p.get("company_id"):
        company_part = research.split("### ", 2)
        if len(company_part) > 1:
            try:
                pod.records.update("companies", p["company_id"],
                                   {"research": research[:4000]})
            except Exception:
                pass

    res.ok = True
    res.wrote = True
    res.research = research
    return res
