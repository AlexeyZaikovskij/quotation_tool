from flask import Flask, jsonify, request, render_template
import json
import re
import os

app = Flask(__name__)

DATA_DIR      = os.path.join(os.path.dirname(__file__), "data")
CATALOG_FILE  = os.path.join(DATA_DIR, "catalog.json")
PRICELIST_FILE = os.path.join(DATA_DIR, "pricelist.json")
CONTACTS_FILE   = os.path.join(DATA_DIR, "contacts.json")
SIGNERS_FILE    = os.path.join(DATA_DIR, "signers.json")
CONFIG_FILE     = os.path.join(DATA_DIR, "config.json")

from database import save_quotation, get_quotation, list_versions, list_all, delete_quotation


# ── Helpers ──────────────────────────────────────────────

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_contacts(role="sales"):
    fpath = SIGNERS_FILE if role == "signers" else CONTACTS_FILE
    if not os.path.exists(fpath):
        if role == "signers":
            default = [{"name": "Alexey Zaikovskij", "email": "alexey.zaikovskij@stream-labs.com"}]
        else:
            default = [
                {"name": "Alexey Zaikovskij",  "email": "alexey.zaikovskij@stream-labs.com"},
                {"name": "Stalin Simson",       "email": "stalin.simson@stream-labs.com"},
            ]
        save_json(fpath, default)
        return default
    return load_json(fpath)


# ── Pages ─────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── HW Catalog (server components) ───────────────────────

@app.route("/api/catalog", methods=["GET"])
def get_catalog():
    cat = load_json(CATALOG_FILE)
    try:
        from datetime import datetime as _dt
        cat["_updated"] = _dt.fromtimestamp(os.path.getmtime(CATALOG_FILE)).strftime("%d.%m.%Y")
    except Exception:
        pass
    return jsonify(cat)

@app.route("/api/catalog/category", methods=["POST"])
def add_category():
    body = request.get_json()
    name = body.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    catalog = load_json(CATALOG_FILE)
    new_id = name.lower().replace(" ", "_").replace("/", "_")
    if any(c["id"] == new_id for c in catalog["categories"]):
        return jsonify({"error": "Category already exists"}), 409
    catalog["categories"].append({"id": new_id, "name": name, "has_qty": False, "items": []})
    save_json(CATALOG_FILE, catalog)
    return jsonify({"id": new_id, "name": name})

@app.route("/api/catalog/category/<cat_id>", methods=["PUT"])
def rename_category(cat_id):
    body = request.get_json()
    new_name = body.get("name", "").strip()
    if not new_name:
        return jsonify({"error": "Name is required"}), 400
    catalog = load_json(CATALOG_FILE)
    for cat in catalog["categories"]:
        if cat["id"] == cat_id:
            cat["name"] = new_name
            save_json(CATALOG_FILE, catalog)
            return jsonify({"ok": True})
    return jsonify({"error": "Not found"}), 404

@app.route("/api/catalog/category/<cat_id>", methods=["DELETE"])
def delete_category(cat_id):
    catalog = load_json(CATALOG_FILE)
    catalog["categories"] = [c for c in catalog["categories"] if c["id"] != cat_id]
    for sec in catalog["sections"].values():
        if cat_id in sec:
            sec.remove(cat_id)
    save_json(CATALOG_FILE, catalog)
    return jsonify({"ok": True})

@app.route("/api/catalog/category/<cat_id>/item", methods=["POST"])
def add_item(cat_id):
    body = request.get_json()
    item = body.get("item")
    if not item:
        return jsonify({"error": "Item is required"}), 400
    if isinstance(item, str):
        item = item.strip()
        if not item:
            return jsonify({"error": "Item is required"}), 400
    catalog = load_json(CATALOG_FILE)
    for cat in catalog["categories"]:
        if cat["id"] == cat_id:
            cat["items"].append(item)
            save_json(CATALOG_FILE, catalog)
            return jsonify({"ok": True})
    return jsonify({"error": "Category not found"}), 404

@app.route("/api/catalog/category/<cat_id>/item/<int:idx>", methods=["PUT"])
def edit_item(cat_id, idx):
    body = request.get_json()
    new_item = body.get("item")
    if not new_item:
        return jsonify({"error": "Item is required"}), 400
    # Accept both string and object (CPU with meta)
    if isinstance(new_item, str):
        new_item = new_item.strip()
        if not new_item:
            return jsonify({"error": "Item is required"}), 400
    catalog = load_json(CATALOG_FILE)
    for cat in catalog["categories"]:
        if cat["id"] == cat_id:
            if 0 <= idx < len(cat["items"]):
                cat["items"][idx] = new_item
                save_json(CATALOG_FILE, catalog)
                return jsonify({"ok": True})
            return jsonify({"error": "Index out of range"}), 400
    return jsonify({"error": "Category not found"}), 404

@app.route("/api/catalog/category/<cat_id>/item/<int:idx>", methods=["DELETE"])
def delete_item(cat_id, idx):
    catalog = load_json(CATALOG_FILE)
    for cat in catalog["categories"]:
        if cat["id"] == cat_id:
            if 0 <= idx < len(cat["items"]):
                cat["items"].pop(idx)
                save_json(CATALOG_FILE, catalog)
                return jsonify({"ok": True})
            return jsonify({"error": "Index out of range"}), 400
    return jsonify({"error": "Category not found"}), 404


# ── Pricelist ─────────────────────────────────────────────

@app.route("/api/pricelist", methods=["GET"])
def get_pricelist():
    return jsonify(load_json(PRICELIST_FILE))

def _parse_xlsx_to_catalog(wb):
    """Parse an openpyxl workbook into catalog list."""
    ABBREV_MAP = {
        "MULTIPROBE-STRATOVIEW": "MP",
        "VPLAY-AIRX-REC-MEDIA":  "VP",
        "MULTISCREEN-MULTIREC":  "MS",
        "HW-DEVICES":            "HW",
    }
    catalog = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        current_name, current_items, pending_header = None, [], None
        for row in ws.iter_rows(values_only=True):
            col0 = str(row[0]).strip() if row[0] else ""
            col1 = str(row[1]).strip() if len(row) > 1 and row[1] else ""
            if not col0 and not col1:
                continue
            if col0 == "OEM code":
                if pending_header is not None:
                    if current_name and current_items:
                        catalog.append({"name": current_name, "sheet": sheet_name,
                                        "abbrev": ABBREV_MAP.get(sheet_name, "XX"),
                                        "items": current_items})
                    current_name, current_items = pending_header, []
                pending_header = None
                continue
            col2 = row[2] if len(row) > 2 else None
            price = float(col2) if col2 and isinstance(col2, (int, float)) else None
            looks_like_code = (col1 and len(col0) <= 25
                               and " " not in col0.replace("-", "").replace("_", "")
                               and col0 not in ("MONTHLY",))
            if looks_like_code:
                pending_header = None
                current_items.append({
                    "code": col0, "desc": col1,
                    "desc_short": col1.split("\n")[0].strip(), "price": price,
                })
            else:
                if current_name and current_items:
                    catalog.append({"name": current_name, "sheet": sheet_name,
                                    "abbrev": ABBREV_MAP.get(sheet_name, "XX"),
                                    "items": current_items})
                    current_items = []
                pending_header = col0.split("\n")[0].strip()
                current_name = None
        if current_name and current_items:
            catalog.append({"name": current_name, "sheet": sheet_name,
                            "abbrev": ABBREV_MAP.get(sheet_name, "XX"),
                            "items": current_items})
    return catalog


def _merge_catalogs(existing, incoming):
    """Merge incoming catalog into existing:
    - Update price + desc for matching codes
    - Add new items/groups
    - Mark items missing from incoming as deprecated (keep them)
    Returns (merged, stats)
    """
    # Build lookup: code -> (group_idx, item_idx) in existing
    ex_index = {}
    for gi, grp in enumerate(existing):
        for ii, item in enumerate(grp["items"]):
            ex_index[item["code"]] = (gi, ii)

    # Build lookup: code -> item in incoming
    in_index = {}
    for grp in incoming:
        for item in grp["items"]:
            in_index[item["code"]] = item

    stats = {"updated": 0, "added": 0, "deprecated": 0, "groups_added": 0}

    # 1. Update existing items, mark missing as deprecated
    for grp in existing:
        for item in grp["items"]:
            if item["code"] in in_index:
                new = in_index[item["code"]]
                if new.get("price") is not None:
                    item["price"] = new["price"]
                item["desc"]       = new.get("desc",       item["desc"])
                item["desc_short"] = new.get("desc_short", item["desc_short"])
                item.pop("deprecated", None)   # un-deprecate if it was
                stats["updated"] += 1
            else:
                if not item.get("deprecated"):
                    item["deprecated"] = True
                    stats["deprecated"] += 1

    # 2. Add new items — attach to existing group or create new group
    ex_groups_by_name = {grp["name"]: grp for grp in existing}
    for in_grp in incoming:
        for item in in_grp["items"]:
            if item["code"] not in ex_index:
                # Find or create matching group
                target = ex_groups_by_name.get(in_grp["name"])
                if target is None:
                    target = {
                        "name":   in_grp["name"],
                        "sheet":  in_grp.get("sheet", ""),
                        "abbrev": in_grp.get("abbrev", "XX"),
                        "items":  [],
                    }
                    existing.append(target)
                    ex_groups_by_name[in_grp["name"]] = target
                    stats["groups_added"] += 1
                target["items"].append(item)
                stats["added"] += 1

    return existing, stats


@app.route("/api/pricelist/upload", methods=["POST"])
def upload_pricelist():
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400
    f = request.files["file"]
    tmp = os.path.join(DATA_DIR, "_upload_tmp.xlsx")
    f.save(tmp)
    try:
        from openpyxl import load_workbook
        wb = load_workbook(tmp)
        incoming = _parse_xlsx_to_catalog(wb)
        os.remove(tmp)

        # Merge with existing
        existing = load_json(PRICELIST_FILE) if os.path.exists(PRICELIST_FILE) else []
        merged, stats = _merge_catalogs(existing, incoming)
        save_json(PRICELIST_FILE, merged)

        total_items = sum(len(g["items"]) for g in merged)
        return jsonify({
            "ok": True,
            "groups": len(merged),
            "items": total_items,
            "stats": stats,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Pricelist item editing ────────────────────────────────

@app.route("/api/pricelist/item", methods=["PUT"])
def edit_pricelist_item():
    """Edit a single pricelist item by group index and item index."""
    body    = request.get_json()
    gi      = body.get("group_idx")
    ii      = body.get("item_idx")
    if gi is None or ii is None:
        return jsonify({"error": "group_idx and item_idx required"}), 400
    pl = load_json(PRICELIST_FILE)
    if not (0 <= gi < len(pl)) or not (0 <= ii < len(pl[gi]["items"])):
        return jsonify({"error": "Index out of range"}), 404
    item = pl[gi]["items"][ii]
    if "price"      in body: item["price"]      = body["price"]
    if "desc_short" in body: item["desc_short"] = body["desc_short"].strip()
    if "desc"       in body: item["desc"]        = body["desc"].strip()
    if "code"       in body: item["code"]        = body["code"].strip()
    # Un-deprecate if explicitly edited
    item.pop("deprecated", None)
    save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True})


@app.route("/api/pricelist/item/deprecate", methods=["PUT"])
def toggle_deprecate_item():
    """Toggle deprecated flag on a pricelist item."""
    body = request.get_json()
    gi, ii = body.get("group_idx"), body.get("item_idx")
    if gi is None or ii is None:
        return jsonify({"error": "group_idx and item_idx required"}), 400
    pl = load_json(PRICELIST_FILE)
    if not (0 <= gi < len(pl)) or not (0 <= ii < len(pl[gi]["items"])):
        return jsonify({"error": "Index out of range"}), 404
    item = pl[gi]["items"][ii]
    item["deprecated"] = not item.get("deprecated", False)
    save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True, "deprecated": item["deprecated"]})


@app.route("/api/pricelist/group/<int:gi>", methods=["PUT"])
def rename_pricelist_group(gi):
    body = request.get_json()
    pl = load_json(PRICELIST_FILE)
    if not (0 <= gi < len(pl)):
        return jsonify({"error": "Not found"}), 404
    if "name" in body:
        pl[gi]["name"] = body["name"].strip()
    if "abbrev" in body:
        pl[gi]["abbrev"] = body["abbrev"].strip().upper()
    if "description" in body:
        pl[gi]["description"] = body["description"].strip()
    if "section_label" in body:
        pl[gi]["section_label"] = body["section_label"].strip()
    save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True})


@app.route("/api/pricelist/group/<int:gi>", methods=["DELETE"])
def delete_pricelist_group(gi):
    pl = load_json(PRICELIST_FILE)
    if not (0 <= gi < len(pl)):
        return jsonify({"error": "Not found"}), 404
    pl.pop(gi)
    save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True})


@app.route("/api/pricelist/item/<int:gi>/<int:ii>", methods=["DELETE"])
def delete_pricelist_item(gi, ii):
    pl = load_json(PRICELIST_FILE)
    if not (0 <= gi < len(pl)) or not (0 <= ii < len(pl[gi]["items"])):
        return jsonify({"error": "Not found"}), 404
    pl[gi]["items"].pop(ii)
    save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True})


@app.route("/api/pricelist/group", methods=["POST"])
def add_pricelist_group():
    body   = request.get_json()
    name   = body.get("name",   "").strip()
    abbrev = body.get("abbrev", "").strip().upper()
    if not name:
        return jsonify({"error": "Name required"}), 400
    pl = load_json(PRICELIST_FILE)
    pl.append({"name": name, "abbrev": abbrev or "??", "sheet": "", "items": []})
    save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True, "index": len(pl) - 1})


@app.route("/api/pricelist/group/<int:gi>/item", methods=["POST"])
def add_pricelist_item(gi):
    body  = request.get_json()
    code  = body.get("code",  "").strip()
    desc  = body.get("desc",  "").strip()
    price = body.get("price", None)
    if not code:
        return jsonify({"error": "Code required"}), 400
    pl = load_json(PRICELIST_FILE)
    if not (0 <= gi < len(pl)):
        return jsonify({"error": "Group not found"}), 404
    pl[gi]["items"].append({
        "code": code,
        "desc": desc,
        "desc_short": desc,
        "price": float(price) if price is not None else None,
    })
    save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True, "index": len(pl[gi]["items"]) - 1})


# ── Sales Contacts ────────────────────────────────────────

@app.route("/api/contacts", methods=["GET"])
def get_contacts():
    role = request.args.get("role", "sales")
    return jsonify(load_contacts(role))

@app.route("/api/contacts", methods=["POST"])
def add_contact():
    body  = request.get_json()
    role  = body.get("role", "sales")
    fpath = SIGNERS_FILE if role == "signers" else CONTACTS_FILE
    name  = body.get("name",  "").strip()
    email = body.get("email", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    contacts = load_contacts(role)
    contacts.append({"name": name, "email": email})
    save_json(fpath, contacts)
    return jsonify({"ok": True, "index": len(contacts) - 1})

@app.route("/api/contacts/<int:idx>", methods=["PUT"])
def update_contact(idx):
    body  = request.get_json()
    role  = body.get("role", "sales")
    fpath = SIGNERS_FILE if role == "signers" else CONTACTS_FILE
    contacts = load_contacts(role)
    if not (0 <= idx < len(contacts)):
        return jsonify({"error": "Not found"}), 404
    contacts[idx]["name"]  = body.get("name",  contacts[idx]["name"]).strip()
    contacts[idx]["email"] = body.get("email", contacts[idx]["email"]).strip()
    save_json(fpath, contacts)
    return jsonify({"ok": True})

@app.route("/api/contacts/<int:idx>", methods=["DELETE"])
def delete_contact(idx):
    role  = request.args.get("role", "sales")
    fpath = SIGNERS_FILE if role == "signers" else CONTACTS_FILE
    contacts = load_contacts(role)
    if not (0 <= idx < len(contacts)):
        return jsonify({"error": "Not found"}), 404
    contacts.pop(idx)
    save_json(fpath, contacts)
    return jsonify({"ok": True})



# ── Export ────────────────────────────────────────────────

import sys, uuid, tempfile, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "export"))

EXPORT_DIR = os.path.join(os.path.dirname(__file__), "export", "tmp")
os.makedirs(EXPORT_DIR, exist_ok=True)
_export_tokens = {}   # token -> filepath

def _build_filename(data, ext):
    raw     = data.get("company", "CLIENT").strip() or "CLIENT"
    # Replace spaces and hyphens with underscores, remove other non-alphanumeric chars
    company = re.sub(r'[\s\-]+', '_', raw)
    company = re.sub(r'[^\w]', '', company)   # keep letters, digits, underscore
    company = company[:40] or "CLIENT"
    qid     = data.get("quote_id", "PP_V1").replace(" ", "_")
    return f"{company}_{qid}.{ext}"

def _xlsx_path(data):
    from generate_xlsx import generate_xlsx
    fname = _build_filename(data, "xlsx")
    path  = os.path.join(EXPORT_DIR, fname)
    generate_xlsx(data, path)
    return path, fname

def _pdf_path(data, fname_base):
    """PDF export: open preview HTML in browser and use browser Print -> Save as PDF."""
    return None, "Use Preview to open the document in browser, then Print / Save as PDF (Ctrl+P)."  

@app.route("/api/export/xlsx", methods=["POST"])
def export_xlsx():
    from flask import send_file
    data = request.get_json()
    data["_company"] = active_company()
    try:
        path, fname = _xlsx_path(data)
        return send_file(path, as_attachment=True, download_name=fname,
                         mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/export/pdf", methods=["POST"])
def export_pdf():
    from flask import send_file
    data = request.get_json()
    try:
        fname_base = _build_filename(data, "pdf")
        pdf_path, err = _pdf_path(data, fname_base)
        if not pdf_path:
            return jsonify({"error": "PDF generation failed: " + str(err)}), 500
        return send_file(pdf_path, as_attachment=True, download_name=fname_base,
                         mimetype="application/pdf")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/export/both", methods=["POST"])
def export_both():
    data = request.get_json()
    try:
        xlsx_path, xlsx_fname = _xlsx_path(data)
        tok_x = str(uuid.uuid4())
        _export_tokens[tok_x] = (xlsx_path, xlsx_fname)

        pdf_fname_base = _build_filename(data, "pdf")
        pdf_path, err  = _pdf_path(data, pdf_fname_base)
        result = {"xlsx": tok_x}
        if pdf_path:
            tok_p = str(uuid.uuid4())
            _export_tokens[tok_p] = (pdf_path, pdf_fname_base)
            result["pdf"] = tok_p
        else:
            result["pdf_error"] = str(err)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/export/download/<token>")
def export_download(token):
    from flask import send_file
    if token not in _export_tokens:
        return jsonify({"error": "Token not found or expired"}), 404
    path, fname = _export_tokens.pop(token)
    mime = "application/pdf" if fname.endswith(".pdf") else            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return send_file(path, as_attachment=True, download_name=fname, mimetype=mime)


# ── Preview ───────────────────────────────────────────────

PREVIEW_HTML = os.path.join(EXPORT_DIR, "_preview.html")

@app.route("/api/preview", methods=["POST"])
def preview():
    """Build preview HTML and return it directly — browser renders and can print to PDF."""
    from generate_pdf import build_html
    data = request.get_json()
    data["_company"] = active_company()
    try:
        html = build_html(data)
        # Save for /api/preview/html
        with open(PREVIEW_HTML, "w", encoding="utf-8") as f:
            f.write(html)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/preview/html")
def preview_html():
    if not os.path.exists(PREVIEW_HTML):
        return "No preview generated yet", 404
    with open(PREVIEW_HTML, "r", encoding="utf-8") as f:
        content = f.read()
    return content, 200, {"Content-Type": "text/html; charset=utf-8"}


# ── Companies & Assets ───────────────────────────────────

ASSETS_DIR     = os.path.join(DATA_DIR, "assets")
COMPANIES_FILE = os.path.join(DATA_DIR, "companies.json")
os.makedirs(ASSETS_DIR, exist_ok=True)

def load_companies():
    if not os.path.exists(COMPANIES_FILE):
        default = [{"id":"streamlabs","name":"SIA STREAM LABS (EUROPE)",
            "address":"Siguldas 37, Daugavpils, LV-5417","vat":"LV41503066927",
            "email":"info@stream-labs.com","website":"www.stream-labs.com",
            "logo":"logo_streamlabs.png","active":True}]
        save_json(COMPANIES_FILE, default)
        return default
    return load_json(COMPANIES_FILE)

def active_company():
    cos = load_companies()
    return next((c for c in cos if c.get("active")), cos[0] if cos else {})

@app.route("/api/companies", methods=["GET"])
def get_companies():
    return jsonify(load_companies())

@app.route("/api/companies", methods=["POST"])
def add_company():
    body = request.get_json()
    cos  = load_companies()
    cos.append({"id":body.get("id",f"company_{len(cos)+1}"),
        "name":body.get("name","").strip(),"address":body.get("address","").strip(),
        "vat":body.get("vat","").strip(),"email":body.get("email","").strip(),
        "website":body.get("website","").strip(),"logo":body.get("logo",""),"active":False})
    save_json(COMPANIES_FILE, cos)
    return jsonify({"ok":True,"index":len(cos)-1})

@app.route("/api/companies/<int:idx>", methods=["PUT"])
def update_company(idx):
    cos = load_companies()
    if not (0 <= idx < len(cos)): return jsonify({"error":"Not found"}), 404
    body = request.get_json()
    for key in ("name","address","vat","email","website","logo"):
        if key in body: cos[idx][key] = body[key]
    save_json(COMPANIES_FILE, cos)
    return jsonify({"ok":True})

@app.route("/api/companies/<int:idx>/activate", methods=["POST"])
def activate_company(idx):
    cos = load_companies()
    if not (0 <= idx < len(cos)): return jsonify({"error":"Not found"}), 404
    for i,c in enumerate(cos): c["active"] = (i == idx)
    save_json(COMPANIES_FILE, cos)
    return jsonify({"ok":True})

@app.route("/api/companies/<int:idx>", methods=["DELETE"])
def delete_company(idx):
    cos = load_companies()
    if not (0 <= idx < len(cos)): return jsonify({"error":"Not found"}), 404
    cos.pop(idx)
    if cos and not any(c.get("active") for c in cos): cos[0]["active"] = True
    save_json(COMPANIES_FILE, cos)
    return jsonify({"ok":True})

@app.route("/api/companies/logo", methods=["POST"])
def upload_logo():
    if "file" not in request.files: return jsonify({"error":"No file"}), 400
    f    = request.files["file"]
    name = f.filename.replace(" ","_")
    f.save(os.path.join(ASSETS_DIR, name))
    return jsonify({"ok":True,"filename":name})

@app.route("/api/assets/<filename>")
def serve_asset(filename):
    from flask import send_from_directory
    return send_from_directory(ASSETS_DIR, filename)


@app.route("/api/jira/create-issue", methods=["POST"])
def jira_create_issue():
    from jira_integration import create_issue
    body = request.get_json() or {}

    # Resolve the acting user's own Jira PAT (if configured) so the issue is
    # authored under their identity rather than the shared default token.
    reporter_login = (body.get("reporter_login") or "").strip()
    if reporter_login:
        cfg   = load_json(CONFIG_FILE)
        users = cfg.get("users", [])
        user  = next((u for u in users if u.get("login") == reporter_login), None)
        if user and user.get("jira_token"):
            body["reporter_token"] = user["jira_token"]

    return jsonify(create_issue(body))


# ── Unified users (Jira login/token + quotation DB attribution) ──────────

@app.route("/api/users", methods=["GET"])
def api_get_users():
    cfg = load_json(CONFIG_FILE)
    # Never leak stored PAT tokens to the browser.
    return jsonify([
        {"name": u.get("name", ""), "login": u.get("login", ""), "email": u.get("email", ""),
         "has_token": bool(u.get("jira_token"))}
        for u in cfg.get("users", [])
    ])


@app.route("/api/users", methods=["POST"])
def api_add_user():
    body  = request.get_json() or {}
    login = (body.get("login") or "").strip()
    name  = (body.get("name") or "").strip()
    if not login or not name:
        return jsonify({"error": "Name and login are required"}), 400
    cfg = load_json(CONFIG_FILE)
    users = cfg.setdefault("users", [])
    if any(u.get("login") == login for u in users):
        return jsonify({"error": f"User with login '{login}' already exists"}), 400
    users.append({
        "name": name, "login": login,
        "email": (body.get("email") or "").strip(),
        "jira_token": (body.get("jira_token") or "").strip(),
    })
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True, "index": len(users) - 1})


@app.route("/api/users/<int:idx>", methods=["PUT"])
def api_update_user(idx):
    body = request.get_json() or {}
    cfg  = load_json(CONFIG_FILE)
    users = cfg.setdefault("users", [])
    if not (0 <= idx < len(users)):
        return jsonify({"error": "Not found"}), 404
    u = users[idx]
    if "name"  in body: u["name"]  = body["name"].strip()
    if "login" in body: u["login"] = body["login"].strip()
    if "email" in body: u["email"] = body["email"].strip()
    if "jira_token" in body and body["jira_token"]:
        u["jira_token"] = body["jira_token"].strip()
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True})


@app.route("/api/users/<int:idx>", methods=["DELETE"])
def api_delete_user(idx):
    cfg   = load_json(CONFIG_FILE)
    users = cfg.setdefault("users", [])
    if not (0 <= idx < len(users)):
        return jsonify({"error": "Not found"}), 404
    users.pop(idx)
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True})


# ── Jira assignees (separate, editable list — independent of Users) ──────

def _normalize_assignees(raw):
    """Older config format stored assignees as plain username strings."""
    out = []
    for a in raw:
        if isinstance(a, str):
            out.append({"name": a, "login": a})
        else:
            out.append({"name": a.get("name", a.get("login", "")), "login": a.get("login", "")})
    return out


@app.route("/api/jira/assignees", methods=["GET"])
def api_get_assignees():
    cfg = load_json(CONFIG_FILE)
    return jsonify(_normalize_assignees(cfg.get("jira", {}).get("assignees", [])))


@app.route("/api/jira/assignees", methods=["POST"])
def api_add_assignee():
    body  = request.get_json() or {}
    login = (body.get("login") or "").strip()
    name  = (body.get("name") or "").strip() or login
    if not login:
        return jsonify({"error": "Login is required"}), 400
    cfg = load_json(CONFIG_FILE)
    jira = cfg.setdefault("jira", {})
    assignees = _normalize_assignees(jira.get("assignees", []))
    if any(a["login"] == login for a in assignees):
        return jsonify({"error": f"Assignee '{login}' already exists"}), 400
    assignees.append({"name": name, "login": login})
    jira["assignees"] = assignees
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True, "index": len(assignees) - 1})


@app.route("/api/jira/assignees/<int:idx>", methods=["PUT"])
def api_update_assignee(idx):
    body = request.get_json() or {}
    cfg  = load_json(CONFIG_FILE)
    jira = cfg.setdefault("jira", {})
    assignees = _normalize_assignees(jira.get("assignees", []))
    if not (0 <= idx < len(assignees)):
        return jsonify({"error": "Not found"}), 404
    if "name"  in body: assignees[idx]["name"]  = body["name"].strip()
    if "login" in body: assignees[idx]["login"] = body["login"].strip()
    jira["assignees"] = assignees
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True})


@app.route("/api/jira/assignees/<int:idx>", methods=["DELETE"])
def api_delete_assignee(idx):
    cfg  = load_json(CONFIG_FILE)
    jira = cfg.setdefault("jira", {})
    assignees = _normalize_assignees(jira.get("assignees", []))
    if not (0 <= idx < len(assignees)):
        return jsonify({"error": "Not found"}), 404
    assignees.pop(idx)
    jira["assignees"] = assignees
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True})


@app.route("/api/jira/config", methods=["GET"])
def jira_get_config():
    cfg = load_json(CONFIG_FILE)
    jira = cfg.get("jira", {})
    return jsonify({"email": jira.get("email", ""), "users": jira.get("users", [])})


@app.route("/api/jira/config", methods=["POST"])
def jira_save_config():
    body = request.get_json()
    cfg  = load_json(CONFIG_FILE)
    if "jira" not in cfg: cfg["jira"] = {}
    if "email" in body: cfg["jira"]["email"] = body["email"].strip()
    if "users" in body: cfg["jira"]["users"] = body["users"]
    save_json(CONFIG_FILE, cfg)
    return jsonify({"ok": True})


@app.route("/api/pipedrive/deal/<deal_id>")
def pipedrive_deal(deal_id):
    from pipedrive import fetch_deal
    return jsonify(fetch_deal(deal_id))


@app.route("/api/pipedrive/deal/<deal_id>/value", methods=["POST"])
def pipedrive_update_deal_value(deal_id):
    from pipedrive import update_deal_value
    body     = request.get_json(force=True) or {}
    value    = body.get("value")
    currency = body.get("currency", "USD")
    if value is None:
        return jsonify({"ok": False, "error": "Missing value"}), 400
    return jsonify(update_deal_value(deal_id, value, currency))


@app.route("/api/pipedrive/deal/<deal_id>/file", methods=["POST"])
def pipedrive_upload_file(deal_id):
    from pipedrive import upload_file_to_deal
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "No file provided"}), 400
    return jsonify(upload_file_to_deal(deal_id, f.filename, f.read()))



# ── Product logo upload ───────────────────────────────────

@app.route("/api/pricelist/group/<int:gi>/logo", methods=["POST"])
def upload_product_logo(gi):
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file"}), 400
    ext  = os.path.splitext(f.filename)[1].lower()
    name = f"product_logo_{gi}{ext}"
    f.save(os.path.join(ASSETS_DIR, name))
    # Save logo filename to pricelist group
    pl = load_json(PRICELIST_FILE)
    if 0 <= gi < len(pl):
        pl[gi]["logo"] = name
        save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True, "filename": name})


@app.route("/api/pricelist/group/<int:gi>/logo", methods=["DELETE"])
def delete_product_logo(gi):
    pl = load_json(PRICELIST_FILE)
    if 0 <= gi < len(pl):
        old = pl[gi].pop("logo", None)
        if old:
            try: os.remove(os.path.join(ASSETS_DIR, old))
            except Exception: pass
        save_json(PRICELIST_FILE, pl)
    return jsonify({"ok": True})


# ── Quotation Database API ────────────────────────────────

@app.route("/api/quotations", methods=["GET"])
def api_list_quotations():
    search     = request.args.get("search", "").strip()
    limit      = int(request.args.get("limit", 100))
    offset     = int(request.args.get("offset", 0))
    user       = request.args.get("user", "").strip()
    created_by = "" if user in ("", "all") else user
    return jsonify(list_all(limit=limit, offset=offset, search=search, created_by=created_by))

@app.route("/api/quotations/<deal_id>", methods=["GET"])
def api_list_versions(deal_id):
    return jsonify(list_versions(deal_id))

@app.route("/api/quotations/<deal_id>/<version>", methods=["GET"])
def api_get_quotation(deal_id, version):
    q = get_quotation(deal_id, version)
    if not q:
        return jsonify({"error": "Not found"}), 404
    return jsonify(q)

@app.route("/api/quotations/<deal_id>/<version>", methods=["DELETE"])
def api_delete_quotation(deal_id, version):
    return jsonify({"ok": delete_quotation(deal_id, version)})

@app.route("/api/quotations/save", methods=["POST"])
def api_save_quotation():
    body       = request.get_json()
    deal_id    = (body.get("deal_id") or "").strip()
    version    = (body.get("version") or "V1").strip()
    overwrite  = body.get("overwrite", False)
    data       = body.get("data", {})
    created_by = (body.get("created_by") or "").strip()
    if not deal_id:
        return jsonify({"ok": False, "error": "deal_id is required"}), 400
    return jsonify(save_quotation(deal_id, version, data, overwrite=overwrite, created_by=created_by))


@app.route("/api/exchange-rate")
def exchange_rate():
    """Proxy for ECB/Frankfurter exchange rate. Falls back to ECB XML."""
    import urllib.request, json as _json

    # Try Frankfurter v1 (stable, works on new domain api.frankfurter.dev)
    try:
        req = urllib.request.Request(
            "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR",
            headers={"User-Agent": "StreamLabs-QuotationTool/1.0"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read())
        # data["rates"]["EUR"] = EUR per 1 USD, e.g. 0.9237 → invert to get USD per 1 EUR
        eur_per_usd = data["rates"]["EUR"]
        usd_per_eur = round(1 / eur_per_usd, 4)
        return jsonify({"ok": True, "rate": usd_per_eur, "date": data["date"], "source": "frankfurter"})
    except Exception:
        pass

    # Fallback: ECB reference rates XML
    try:
        req2 = urllib.request.Request(
            "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
            headers={"User-Agent": "StreamLabs-QuotationTool/1.0"}
        )
        with urllib.request.urlopen(req2, timeout=5) as resp:
            xml = resp.read().decode()
        import re
        usd_match = re.search(r"currency='USD'\s+rate='([^']+)'", xml)
        date_match = re.search(r"time='([^']+)'", xml)
        if not usd_match:
            raise ValueError("USD not found in ECB XML")
        usd_per_eur = float(usd_match.group(1))  # ECB publishes USD per 1 EUR, e.g. 1.0825
        date_str = date_match.group(1) if date_match else "—"
        return jsonify({"ok": True, "rate": usd_per_eur, "date": date_str, "source": "ecb"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Entry point ───────────────────────────────────────────

if __name__ == "__main__":
    import socket

    # Find a free port starting from 5000
    port = 5000
    for candidate in range(5000, 5020):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", candidate))
            port = candidate
            break
        except OSError:
            continue

    print("=" * 50)
    print("  Stream Labs — Quotation Tool")
    print(f"  http://localhost:{port}")
    print("  Ctrl+C to stop")
    print("=" * 50)

    # Write the port to a temp file so start.bat can open the right URL
    import os
    with open(os.path.join(os.path.dirname(__file__), ".port"), "w") as f:
        f.write(str(port))

    app.run(host="0.0.0.0", port=port, debug=False)
