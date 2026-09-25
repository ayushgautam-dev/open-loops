#input_type_name: ConnectInput
#output_type_name: ConnectResult
#function_name: connect_source

# Connect one source, end to end, from inside the product.
#
# The founder always finishes on the provider's own consent screen. This never
# sees or handles a credential — it only opens the door.
#
# The thing that makes this more than a one-liner: on a freshly cloned pod the
# organisation has **no connectors installed at all**. The bundle carries tables,
# functions, agents, workflows and the app, but not connector installs, because
# those live on the organisation rather than the pod. So the old version — which
# only looked an install up and gave up if it was missing — told every new owner
# to "add it from the Lemma connectors screen first". That is an admin console a
# person who just cloned a product should never have to find, and it is the whole
# reason this now installs before it connects.
#
# Three further things, each of which was a real bug:
#
# 1. The name in the UI is the *install* (auth config) name, not the connector id.
#    Granola is an install named "granola" on connector "mcp". Passing "granola"
#    as a connector id is a 404.
#
# 2. Whether a source can be authorised in a browser is decided by its **auth
#    scheme, never its kind**. The platform's own note on the field says it
#    plainly: "`mcp` is one catalog entry standing for every server a tenant may
#    point at: the entry says API_KEY, but an install whose server described its
#    own authorization when it was created signs in through a browser and answers
#    OAUTH2 here. Branch on this rather than on the connector's kind." Keying on
#    kind hid Granola from onboarding entirely.
#
# 3. The caller reads `auth_url`; this used to return only `authorization_url`,
#    so the button opened nothing and reported no error. Both are returned now.

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# Schemes with no consent screen to send anybody to.
TOKEN_ONLY_SCHEMES = {"api_key", "bearer_token", "basic", "no_auth"}

# How to install each source we offer, when the organisation has not got it yet.
#
# Gmail, Calendar and Meet are Composio kinds with a system default available, so
# they install with no credentials of our own — the person just signs in.
#
# Granola is deliberately NOT the managed Granola connector: that one is only open
# to Granola's enterprise plan. Everyone on the free plan connects their own MCP
# server instead, which is a plain MCP install pointed at Granola's endpoint.
# Lemma registers itself with that server on creation and the install comes back
# OAUTH2, so the person signs in to their own Granola account like any other source.
INSTALL = {
    "gmail": {"connector_id": "gmail", "kind": "composio"},
    "google_calendar": {"connector_id": "google_calendar", "kind": "composio"},
    "googlemeet": {"connector_id": "googlemeet", "kind": "composio"},
    # optional: lets a document card become a real Google Doc
    "google_docs": {"connector_id": "google_docs", "kind": "composio"},
    # optional: lets a document be shared with just the people it is sent to
    "google_drive": {"connector_id": "google_drive", "kind": "composio"},
    "granola": {
        "connector_id": "mcp",
        "kind": "mcp",
        "config": {"server_url": "https://mcp.granola.ai/mcp"},
    },
}


class ConnectInput(BaseModel):
    app: str


class ConnectResult(BaseModel):
    app: str = ""
    authorization_url: str | None = None
    # Same value under the name the app reads. Keep both in step.
    auth_url: str | None = None
    status: str = ""
    already_connected: bool = False
    # True when this source was installed for the organisation by this call.
    installed_now: bool = False
    # True when it cannot be connected from here at all, whatever we do.
    needs_manual_setup: bool = False
    explanation: str = ""
    errors: list[str] = Field(default_factory=list)


def _find_install(pod, want: str) -> dict | None:
    """The install registered under this name, if the organisation has one."""
    try:
        cfgs = pod.connectors.auth_configs.list().to_dict()
        for c in (cfgs.get("items") or []):
            if str(c.get("name") or "").lower() == want:
                return c
    except Exception:
        return None
    return None


def _has_account(pod, auth_config_id: str) -> bool:
    """Is there a live account against this exact install?"""
    if not auth_config_id:
        return False
    try:
        accts = pod.connectors.accounts.list().to_dict()
        for a in (accts.get("items") or []):
            if str(a.get("auth_config_id")) != auth_config_id:
                continue
            if str(a.get("status") or "").upper() == "CONNECTED":
                return True
    except Exception:
        pass          # a listing hiccup should not block somebody trying to connect
    return False


async def connect_source(ctx: FunctionContext, data: ConnectInput) -> ConnectResult:
    pod = Pod.from_env()
    res = ConnectResult(app=data.app)
    want = (data.app or "").strip().lower()

    cfg = _find_install(pod, want)

    # Already connected? Say so rather than starting a second authorisation.
    #
    # Matched through the install's id, not its name. `status()` labels an account
    # only by connector_id, and every MCP server in the catalogue shares the id
    # "mcp" — so asking it for "granola" finds nothing and a person who had already
    # connected Granola was sent round the sign-in loop a second time. The account's
    # auth_config_id is the only thing that actually identifies which install it
    # belongs to.
    if cfg is not None and _has_account(pod, str(cfg.get("id") or "")):
        res.already_connected = True
        res.status = "already connected"
        return res

    # Nothing installed yet — the normal state on a pod somebody just cloned.
    if cfg is None:
        spec = INSTALL.get(want)
        if not spec:
            res.needs_manual_setup = True
            res.status = "not available"
            res.explanation = (
                f"'{data.app}' is not one of the sources this product knows how to "
                "set up on its own.")
            return res
        try:
            cfg = pod.connectors.create_auth_config_from_dict(
                {**spec, "name": want}).to_dict()
            res.installed_now = True
        except Exception as exc:
            res.errors.append(f"could not install: {str(exc)[:250]}")
            res.status = "could not install"
            res.explanation = (
                "That source could not be set up automatically. It can still be added "
                "from the Lemma connectors screen.")
            return res

    connector_id = str(cfg.get("connector_id") or want)
    auth_config_id = str(cfg.get("id")) if cfg.get("id") else None
    scheme = str(cfg.get("auth_scheme") or "").lower()

    # Decide on the scheme, never the kind — see note 2 at the top.
    if scheme in TOKEN_ONLY_SCHEMES:
        res.needs_manual_setup = True
        res.status = "cannot be connected from here"
        res.explanation = (
            "This source signs in with a token rather than a consent screen, so there "
            "is no page to send you to. It needs a token from the provider, added from "
            "the Lemma connectors screen.")
        return res

    try:
        r = pod.connectors.connect_request(
            connector_id, auth_config_id=auth_config_id).to_dict()
    except Exception as exc:
        msg = str(exc)
        res.errors.append(msg[:250])
        res.status = "could not start"
        if "CONNECTOR_NOT_FOUND" in msg:
            res.explanation = (
                f"'{data.app}' is not available on this Lemma server.")
        elif "accounts API" in msg or "Credential-managed" in msg:
            res.needs_manual_setup = True
            res.explanation = (
                "This source needs a token rather than a sign-in, so it has to be set "
                "up from the Lemma connectors screen.")
        return res

    res.authorization_url = r.get("authorization_url")
    res.auth_url = res.authorization_url
    res.status = str(r.get("status") or "started")
    if not res.authorization_url:
        res.needs_manual_setup = True
        res.explanation = (
            "This source did not offer a sign-in link. It needs connecting from the "
            "Lemma connectors screen.")
    return res
