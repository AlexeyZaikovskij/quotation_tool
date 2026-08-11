"""
Jira Server integration for Stream Labs Quotation Tool.
Uses Personal Access Token (PAT) — Bearer auth, REST API v2.
"""

import json
import os
import urllib.request
import urllib.error
import urllib.parse

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "data", "config.json")


def _load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _jira_request(method: str, path: str, cfg: dict, body: dict = None) -> dict:
    """Make an authenticated request to the Jira Server REST API v2 using PAT."""
    base_url = cfg.get("base_url", "").rstrip("/")
    token    = cfg.get("api_token", "")

    if not all([base_url, token]):
        raise ValueError("Jira base_url and api_token must be set in config.json")

    url = f"{base_url}/rest/api/2{path}"
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _build_wiki_body(
    pipedrive_deal_id: str,
    pipedrive_url: str,
    context_text: str,
    spec_rows: list,
) -> str:
    """Build Jira wiki markup body (used by Jira Server REST API v2)."""
    lines = []

    lines.append("*Прошу утвердить конфигурацию сервера.*")
    lines.append("")

    if pipedrive_url:
        lines.append(f"[Сделка Pipedrive #{pipedrive_deal_id}|{pipedrive_url}]")
        lines.append("")

    if context_text and context_text.strip():
        lines.append(context_text.strip())
        lines.append("")

    for srv in spec_rows:
        srv_name = srv.get("server", "Server")
        srv_qty  = srv.get("qty", 1)
        comps    = srv.get("components", [])

        lines.append(f"*{srv_name}* (qty: {srv_qty})")
        lines.append("")

        if comps:
            lines.append("|| Component || Value ||")
            for comp in comps:
                cat = comp.get("category", "").replace("|", "\\|")
                val = comp.get("value", "").replace("|", "\\|")
                lines.append(f"| {cat} | {val} |")
            lines.append("")

    return "\n".join(lines)


def create_issue(payload: dict) -> dict:
    """
    Create a Jira Task for server configuration approval.

    Expected payload keys:
      deal_id        — Pipedrive deal ID
      company        — Client company name
      country        — Client country
      sales_contact  — Sales manager full name (last name used in title)
      context        — User-written context description
      spec_rows      — List of server config dicts (from getServerConfigTable)
    """
    cfg = _load_config().get("jira", {})

    # Email from UI (selected by user) takes priority over config file default
    if payload.get("email"):
        cfg = dict(cfg)
        cfg["email"] = payload["email"]

    # Per-user Jira PAT — when present, the issue is authored (reporter) as
    # that user instead of the shared default token.
    if payload.get("reporter_token"):
        cfg = dict(cfg)
        cfg["api_token"] = payload["reporter_token"]

    # Build task title:  Конфигурация сервера для "Company" \ PP{deal_id} \ Country \ LastName
    deal_id       = payload.get("deal_id", "")
    company       = payload.get("company", "")
    country       = payload.get("country", "")
    # Prefer pre-extracted last name from Pipedrive owner, fallback to splitting full name
    last_name = payload.get("sales_last_name") or ""
    if not last_name:
        sales_contact = payload.get("sales_contact", "")
        last_name = sales_contact.strip().split()[-1] if sales_contact.strip() else ""

    summary = f'Конфигурация сервера для "{company}" \\ PP{deal_id} \\ {country} \\ {last_name}'

    # Pipedrive deal link
    pipedrive_base = "https://stream-labs.pipedrive.com/deal/"
    pipedrive_url  = f"{pipedrive_base}{deal_id}" if deal_id else ""

    wiki_body = _build_wiki_body(
        pipedrive_deal_id=deal_id,
        pipedrive_url=pipedrive_url,
        context_text=payload.get("context", ""),
        spec_rows=payload.get("spec_rows", []),
    )

    issue_body = {
        "fields": {
            "project":     {"key": cfg.get("project_key", "")},
            "summary":     summary,
            "issuetype":   {"name": cfg.get("issue_type", "Task")},
            "description": wiki_body,
            "components":  [{"name": cfg.get("component", "Presale")}],
        }
    }

    # Assignee — Jira Server uses username (login), not email
    assignee_name = payload.get("assignee_name", "")
    if assignee_name:
        issue_body["fields"]["assignee"] = {"name": assignee_name}

    try:
        result = _jira_request("POST", "/issue", cfg, issue_body)
        issue_key = result.get("key", "")
        issue_url = f"{cfg.get('base_url','').rstrip('/')}/browse/{issue_key}"
        return {"ok": True, "key": issue_key, "url": issue_url}
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode()
        except: pass
        return {"ok": False, "error": f"HTTP {e.code}: {body[:300]}"}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"Network error: {e.reason}"}
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}
