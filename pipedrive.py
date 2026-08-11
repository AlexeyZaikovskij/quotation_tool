"""
Pipedrive API integration for Stream Labs Quotation Tool.
"""

import json
import os
import urllib.request
import urllib.error

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "data", "config.json")


def _load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _get(path: str, token: str) -> dict:
    base = "https://api.pipedrive.com/v1"
    url  = f"{base}{path}?api_token={token}"
    req  = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def _put(path: str, token: str, payload: dict) -> dict:
    base = "https://api.pipedrive.com/v1"
    url  = f"{base}{path}?api_token={token}"
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(url, data=data, method="PUT",
                                   headers={"Accept": "application/json",
                                            "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def update_deal_value(deal_id: str, value: float, currency: str = "USD") -> dict:
    cfg   = _load_config()
    token = cfg.get("pipedrive", {}).get("api_token", "")
    if not token:
        return {"ok": False, "error": "Pipedrive API token not configured"}

    try:
        resp = _put(f"/deals/{deal_id}", token, {"value": value, "currency": currency})
        if not resp.get("success"):
            return {"ok": False, "error": f"Pipedrive rejected the update for deal #{deal_id}"}
        deal = resp.get("data", {})
        return {"ok": True, "deal_id": str(deal_id),
                "deal_value": deal.get("value", value),
                "deal_currency": deal.get("currency", currency)}
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"ok": False, "error": "Invalid Pipedrive API token"}
        if e.code == 404:
            return {"ok": False, "error": f"Deal #{deal_id} not found"}
        return {"ok": False, "error": f"Pipedrive API error: HTTP {e.code}"}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"Network error: {e.reason}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def upload_file_to_deal(deal_id: str, filename: str, content: bytes) -> dict:
    """Attach a file to a Pipedrive deal (multipart/form-data POST to /v1/files)."""
    cfg   = _load_config()
    token = cfg.get("pipedrive", {}).get("api_token", "")
    if not token:
        return {"ok": False, "error": "Pipedrive API token not configured"}

    boundary = "----QuotationToolBoundary7d1f2b3a"
    parts = []
    parts.append(f"--{boundary}\r\n"
                 f'Content-Disposition: form-data; name="deal_id"\r\n\r\n{deal_id}\r\n')
    parts.append(f"--{boundary}\r\n"
                 f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                 f"Content-Type: application/octet-stream\r\n\r\n")
    body = ("".join(parts)).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")

    try:
        url = f"https://api.pipedrive.com/v1/files?api_token={token}"
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
        if not resp.get("success"):
            return {"ok": False, "error": f"Pipedrive rejected the upload for deal #{deal_id}"}
        file_data = resp.get("data", {})
        return {"ok": True, "deal_id": str(deal_id), "file_id": file_data.get("id"),
                "file_name": file_data.get("name", filename)}
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"ok": False, "error": "Invalid Pipedrive API token"}
        if e.code == 404:
            return {"ok": False, "error": f"Deal #{deal_id} not found"}
        body_txt = ""
        try: body_txt = e.read().decode()
        except Exception: pass
        return {"ok": False, "error": f"Pipedrive API error: HTTP {e.code} {body_txt[:200]}"}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"Network error: {e.reason}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def fetch_deal(deal_id: str) -> dict:
    cfg   = _load_config()
    token = cfg.get("pipedrive", {}).get("api_token", "")
    if not token:
        return {"ok": False, "error": "Pipedrive API token not configured"}

    try:
        deal_resp = _get(f"/deals/{deal_id}", token)
        if not deal_resp.get("success") or not deal_resp.get("data"):
            return {"ok": False, "error": f"Deal #{deal_id} not found"}

        deal = deal_resp["data"]

        result = {
            "ok":           True,
            "deal_id":      str(deal_id),
            "deal_title":   deal.get("title", ""),
            "deal_value":   deal.get("value", 0),
            "deal_currency": deal.get("currency", "USD"),
            "company":      "",
            "contact":      "",
            "address":      "",
            "country":      "",
            "phone":        "",
            "email":        "",
            "sales_contact": "",       # owner full name
            "sales_last_name": "",     # owner last name for Jira title
        }

        # Owner of the deal — used as Sales Contact in Jira task title
        owner = deal.get("user_id")
        if owner and isinstance(owner, dict):
            owner_name = owner.get("name", "")
            result["sales_contact"] = owner_name
            result["sales_last_name"] = owner_name.strip().split()[-1] if owner_name.strip() else ""

        # Organization → company name + address
        org = deal.get("org_id")
        if org and isinstance(org, dict):
            result["company"] = org.get("name", "")
            try:
                org_resp = _get(f"/organizations/{org['value']}", token)
                org_data = org_resp.get("data", {})
                addr = org_data.get("address") or ""
                if addr:
                    parts = [p.strip() for p in addr.split(",") if p.strip()]
                    if parts:
                        result["country"] = parts[-1]
                        result["address"] = ", ".join(parts[:-1])
            except Exception:
                pass

        # Contact person → name + phone + email
        person = deal.get("person_id")
        if person and isinstance(person, dict):
            result["contact"] = person.get("name", "")
            try:
                per_resp = _get(f"/persons/{person['value']}", token)
                per_data = per_resp.get("data", {})
                phones = per_data.get("phone", [])
                if phones:
                    primary = next((p for p in phones if p.get("primary")), phones[0])
                    result["phone"] = primary.get("value", "")
                emails = per_data.get("email", [])
                if emails:
                    primary = next((e for e in emails if e.get("primary")), emails[0])
                    result["email"] = primary.get("value", "")
            except Exception:
                pass

        return result

    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"ok": False, "error": "Invalid Pipedrive API token"}
        if e.code == 404:
            return {"ok": False, "error": f"Deal #{deal_id} not found"}
        return {"ok": False, "error": f"Pipedrive API error: HTTP {e.code}"}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"Network error: {e.reason}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
