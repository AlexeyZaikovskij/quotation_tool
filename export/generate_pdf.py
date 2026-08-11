"""
Generates a quotation PDF via WeasyPrint (HTML -> PDF).
The same HTML template is used for both Preview and PDF export,
so what you see in preview is exactly what you get in the file.
"""
from datetime import datetime, timedelta
import os

C_NAVY   = "#1D2F41"
C_TEXT   = "#40495a"
C_MUTED  = "#7c85b3"
C_ACCENT = "#2563eb"
C_BORDER = "#dde0ea"
C_LIGHT  = "#f4f6fb"

def _esc(s):
    return str(s or "").replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\n","<br>")

def _fmt(n, currency="USD", usd_rate=1.08):
    val = float(n or 0)
    if currency == "EUR":
        val = val / usd_rate
        return f"€&nbsp;{val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"$&nbsp;{val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

def _css():
    return f"""
    @page {{
        size: A4;
        margin: 14mm 14mm 16mm 14mm;
        @bottom-center {{
            content: "Page " counter(page) " of " counter(pages);
            font-family: Arial, sans-serif;
            font-size: 7pt;
            color: {C_MUTED};
        }}
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: Arial, sans-serif; font-size: 8pt; color: {C_TEXT}; background: #fff; }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 8px; }}
    td, th {{ border: 1px solid #dde0ea; padding: 4px 6px; vertical-align: top; }}
    .no-border td, .no-border th {{ border: none; }}

    /* Header */
    .doc-title {{ font-size: 18pt; font-weight: 700; text-align: right;
                  color: {C_TEXT}; margin-bottom: 10px; }}
    .client-block {{ width: 100%; margin-bottom: 8px; }}
    .client-cell {{ width: 55%; vertical-align: top; padding: 8px; border: 1px solid {C_BORDER}; }}
    .client-name {{ font-weight: 700; font-size: 9pt; margin-bottom: 3px; }}
    .client-line {{ margin-bottom: 1px; }}
    .meta-cell {{ vertical-align: top; padding: 8px; border: 1px solid {C_BORDER}; }}
    .meta-lbl {{ color: {C_MUTED}; width: 70px; padding: 2px 4px; border: none; font-size: 7.5pt; }}
    .meta-val {{ padding: 2px 4px; border: none; font-size: 7.5pt; }}
    .meta-val.bold {{ font-weight: 700; }}
    .meta-val.accent {{ color: {C_ACCENT}; }}

    /* Section headers */
    .sec-hdr {{ background: {C_NAVY}; color: #fff; font-weight: 700;
                font-size: 8.5pt; padding: 5px 8px; }}
    .col-hdr {{ background: {C_NAVY}; color: #fff; font-size: 7pt;
                text-align: center; padding: 3px 5px; font-weight: 600; }}
    .col-hdr.left {{ text-align: left; }}

    /* Data rows */
    .row-odd  {{ background: #fff; }}
    .row-even {{ background: {C_LIGHT}; }}
    .num {{ text-align: right; white-space: nowrap; }}
    .center {{ text-align: center; }}
    .code {{ color: {C_MUTED}; font-size: 7pt; text-align: center; }}
    .bold {{ font-weight: 700; }}
    .muted {{ color: {C_MUTED}; font-size: 7pt; }}
    .subtotal-row td {{ background: {C_LIGHT}; font-weight: 700; border-top: 1px solid {C_BORDER}; }}

    /* SW discount row */
    .sw-disc-row {{ font-size: 7.5pt; color: {C_MUTED}; padding: 4px 0; }}
    .sw-disc-row td {{ border: none; padding: 2px 6px; }}
    .sw-disc-total {{ font-weight: 700; color: {C_ACCENT}; }}

    /* Grand total */
    .grand-total-table {{ margin-top: 4px; }}
    .grand-total-table td {{
        font-size: 11pt; font-weight: 700; padding: 7px 10px;
        border: 2px solid {C_NAVY};
    }}
    .grand-total-table .gt-val {{ color: {C_ACCENT}; text-align: right; }}

    /* Terms */
    .terms {{ font-size: 7.5pt; color: {C_TEXT}; line-height: 1.65;
              padding: 8px; border: 1px solid {C_BORDER};
              margin-top: 8px; background: {C_LIGHT}; }}
    .terms-title {{ font-weight: 700; margin-bottom: 4px; }}

    /* Footer */
    .doc-footer {{ text-align: center; color: {C_MUTED}; font-style: italic;
                   font-size: 7.5pt; margin-top: 10px; }}

    /* Office block */
    .office-block {{ font-size: 7pt; color: {C_MUTED}; padding: 6px 8px;
                     border: 1px solid {C_BORDER}; margin-bottom: 8px; }}

    /* Page break control */
    .sec-block {{ page-break-inside: avoid; }}

    /* Screen: center as document */
    body {{ max-width: 820px; margin: 0 auto; padding: 0 20px 40px; }}

    /* Print */
    @media print {{
        @page {{ size: A4; margin: 14mm; }}
        body {{ max-width: none; margin: 0; padding: 0; font-size: 7.5pt; }}
        .no-print {{ display: none !important; }}
    }}
    """

def _svc_desc(text):
    """Render service description: bold first line, rest normal with line breaks."""
    if not text:
        return ""
    lines = text.split("\n")
    first = f'<strong>{_esc(lines[0])}</strong>'
    rest  = "\n".join(_esc(l) for l in lines[1:])
    return first + ("\n" + rest if rest else "")

def build_html(data: dict) -> str:
    currency = data.get("currency", "USD")
    usd_rate = float(data.get("usd_rate") or 1.08)
    fmt = lambda n: _fmt(n, currency, usd_rate)

    date_str   = datetime.now().strftime("%d/%m/%Y")
    valid_days = int(data.get("valid_days") or 30)
    valid_str  = (datetime.now() + timedelta(days=valid_days)).strftime("%d/%m/%Y")
    quote_id   = _esc(data.get("quote_id", "Quotation"))

    co         = data.get("_company", {})
    co_name    = _esc(co.get("name", "SIA STREAM LABS (EUROPE)"))
    co_address = _esc(co.get("address", "Siguldas 37, Daugavpils, LV-5417"))
    co_vat     = (" &bull; EU VAT ID: " + _esc(co.get("vat",""))) if co.get("vat") else ""
    logo_file  = co.get("logo","")
    if logo_file:
        logo_tag = f'<img src="/api/assets/{logo_file}" style="height:44px;max-width:160px;object-fit:contain" alt="logo">'
    else:
        logo_tag = ""

    # ── Header ────────────────────────────────────────────────
    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>{_css()}</style>
</head><body>

<!-- Toolbar — hidden when printing -->
<div class="no-print" style="position:sticky;top:0;z-index:100;background:#1a1d2e;
     display:flex;align-items:center;justify-content:space-between;
     padding:8px 16px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.4)">
  <span style="color:#e2e8f0;font-size:12px;font-weight:600">{quote_id}</span>
  <div style="display:flex;gap:8px">
    <button onclick="window.print()"
      style="height:30px;padding:0 14px;background:#2563eb;color:#fff;
             border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:Arial">
      &#128438;&nbsp; Print / Save as PDF
    </button>
    <button onclick="window.close()"
      style="height:30px;padding:0 14px;background:none;color:#e2e8f0;
             border:1px solid #2e3250;border-radius:6px;cursor:pointer;font-size:12px;font-family:Arial">
      &#10005;&nbsp; Close
    </button>
  </div>
</div>

<!-- Header: logo left, title right -->
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
  <div>{logo_tag}</div>
  <div class="doc-title" style="margin:0">Formal Quotation</div>
</div>

<table class="client-block" style="margin-bottom:8px">
<tr>
  <td class="client-cell">
    <table class="no-border" style="margin:0;width:100%">
      <tr><td style="color:{C_MUTED};font-size:7pt;width:70px;padding:1px 4px;border:none;white-space:nowrap">Company:</td>    <td style="font-weight:700;font-size:9pt;padding:1px 4px;border:none">{_esc(data.get('company',''))}</td></tr>
      <tr><td style="color:{C_MUTED};font-size:7pt;padding:1px 4px;border:none;white-space:nowrap">Address:</td>    <td style="padding:1px 4px;border:none">{_esc(data.get('address',''))}</td></tr>
      <tr><td style="color:{C_MUTED};font-size:7pt;padding:1px 4px;border:none;white-space:nowrap">Country:</td>    <td style="padding:1px 4px;border:none">{_esc(data.get('country',''))}</td></tr>
      <tr><td style="color:{C_MUTED};font-size:7pt;padding:1px 4px;border:none;white-space:nowrap">Contact:</td>    <td style="padding:1px 4px;border:none">{_esc(data.get('contact',''))}</td></tr>
      <tr><td style="color:{C_MUTED};font-size:7pt;padding:1px 4px;border:none;white-space:nowrap">Phone:</td>      <td style="padding:1px 4px;border:none">{_esc(data.get('phone',''))}</td></tr>
      <tr><td style="color:{C_MUTED};font-size:7pt;padding:1px 4px;border:none;white-space:nowrap">Email:</td>      <td style="padding:1px 4px;border:none;color:{C_ACCENT}">{_esc(data.get('email',''))}</td></tr>
    </table>
  </td>
  <td class="meta-cell">
    <table class="no-border" style="margin:0">
      <tr><td class="meta-lbl">Date:</td>        <td class="meta-val">{date_str}</td></tr>
      <tr><td class="meta-lbl">Valid until:</td> <td class="meta-val">{valid_str}</td></tr>
      <tr><td class="meta-lbl">Quote ID:</td>    <td class="meta-val bold">{_esc(data.get('quote_id',''))}</td></tr>
      <tr><td class="meta-lbl">Signed by:</td>   <td class="meta-val">{_esc(data.get('signed_by',''))}</td></tr>
      <tr><td class="meta-lbl">Sales:</td>        <td class="meta-val">{_esc(data.get('sales_contact',''))}</td></tr>
      <tr><td class="meta-lbl"></td>              <td class="meta-val accent">{_esc(data.get('sales_email',''))}</td></tr>
    </table>
  </td>
</tr>
</table>

<div style="display:flex;align-items:center;gap:16px;margin-bottom:8px">
  <div class="office-block" style="margin:0;flex:1">
    {co_name} &bull; {co_address}{co_vat}
  </div>
</div>
"""

    # Summary
    if data.get("summary"):
        html += f"""<table style="margin-bottom:8px">
  <tr><td class="sec-hdr">Summary</td></tr>
  <tr><td style="padding:6px 8px">{_esc(data.get('summary',''))}</td></tr>
</table>
"""

    # ── Hardware ──────────────────────────────────────────────
    hw_list = data.get("hardware", [])
    if hw_list:
        hw_total = sum(h.get("total", 0) or 0 for h in hw_list)
        html += f"""<div class="sec-block">
<table>
  <tr>
    <th class="col-hdr left" style="width:48%">Description</th>
    <th class="col-hdr" style="width:13%">Part #</th>
    <th class="col-hdr" style="width:7%">Qty</th>
    <th class="col-hdr" style="width:16%">Unit Price</th>
    <th class="col-hdr" style="width:16%">Total</th>
  </tr>"""
        html += f'  <tr><td colspan="5" class="sec-hdr" style="font-size:7.5pt;padding:3px 8px">HARDWARE</td></tr>'
        for i, hw in enumerate(hw_list):
            cls = "row-even" if i % 2 else "row-odd"
            up    = hw.get("unit_price") or (hw.get("list_price", 0) * (1 + hw.get("margin", 0) / 100))
            total = hw.get("total") or up * hw.get("qty", 1)
            desc  = f'<strong>{_esc(hw.get("desc",""))}</strong>'
            if hw.get("detail"):
                desc += f'<br><span class="muted">{_esc(hw.get("detail",""))}</span>'
            html += f"""  <tr class="{cls}">
    <td>{desc}</td>
    <td class="code">{_esc(hw.get('pn',''))}</td>
    <td class="center">{hw.get('qty',1)}</td>
    <td class="num">{fmt(up)}</td>
    <td class="num">{fmt(total)}</td>
  </tr>"""
        html += f"""  <tr class="subtotal-row">
    <td colspan="4" class="num">Hardware Total</td>
    <td class="num">{fmt(hw_total)}</td>
  </tr>
</table>
</div>
"""

    # ── Software Licenses ─────────────────────────────────────
    sw_list_total = 0
    for group in data.get("licenses", []):
        items = group.get("items", [])
        if not items:
            continue
        group_total = sum((it.get("qty") or 0) * (it.get("price") or 0) for it in items)
        sw_list_total += group_total
        html += f"""<div class="sec-block">
<table>
  <tr><td colspan="4" class="sec-hdr">{_esc(group.get('name',''))}</td></tr>
  <tr>
    <th class="col-hdr left" style="width:58%">Description</th>
    <th class="col-hdr" style="width:12%">Code</th>
    <th class="col-hdr" style="width:8%">Qty</th>
    <th class="col-hdr" style="width:22%">Total</th>
  </tr>"""
        for i, item in enumerate(items):
            cls   = "row-even" if i % 2 else "row-odd"
            total = (item.get("qty") or 0) * (item.get("price") or 0)
            html += f"""  <tr class="{cls}">
    <td>{_esc(item.get('desc_short') or item.get('desc',''))}</td>
    <td class="code">{_esc(item.get('code',''))}</td>
    <td class="center">{item.get('qty',0)}</td>
    <td class="num">{fmt(total)}</td>
  </tr>"""
        html += f"""  <tr class="subtotal-row">
    <td colspan="3" class="num">Subtotal</td>
    <td class="num">{fmt(group_total)}</td>
  </tr>
</table>
</div>
"""

    # SW discount summary row
    if sw_list_total > 0:
        disc     = data.get("sw_discount", 0) or 0
        sw_disc  = sw_list_total * (1 - disc / 100)
        html += f"""<table class="sw-disc-row" style="margin-bottom:8px">
  <tr>
    <td>SW List: {fmt(sw_list_total)}</td>
    <td>Discount: {disc:.0f}%</td>
    <td class="sw-disc-total">SW Discounted: {fmt(sw_disc)}</td>
  </tr>
</table>
"""
    else:
        sw_disc = 0

    # ── Services ──────────────────────────────────────────────
    svc_list = data.get("services", [])
    if svc_list:
        svc_total = sum((s.get("qty") or 1) * (s.get("unit_price") or 0) for s in svc_list)
        html += f"""<div class="sec-block">
<table>
  <tr><td colspan="4" class="sec-hdr">Support, Warranty, Installation &amp; other services</td></tr>
  <tr>
    <th class="col-hdr left" style="width:58%">Description</th>
    <th class="col-hdr" style="width:8%">Qty</th>
    <th class="col-hdr" style="width:18%">Unit Price</th>
    <th class="col-hdr" style="width:16%">Total</th>
  </tr>"""
        for i, svc in enumerate(svc_list):
            cls   = "row-even" if i % 2 else "row-odd"
            qty   = svc.get("qty") or 1
            up    = svc.get("unit_price") or 0
            total = qty * up
            html += f"""  <tr class="{cls}">
    <td style="white-space:pre-wrap">{_svc_desc(svc.get('desc',''))}</td>
    <td class="center">{qty}</td>
    <td class="num">{fmt(up)}</td>
    <td class="num">{fmt(total)}</td>
  </tr>"""
        html += f"""  <tr class="subtotal-row">
    <td colspan="3" class="num">Services Total</td>
    <td class="num">{fmt(svc_total)}</td>
  </tr>
</table>
</div>
"""
    else:
        svc_total = 0

    # ── Grand Total ───────────────────────────────────────────
    hw_total_all = sum(h.get("total", 0) or 0 for h in hw_list)
    grand = hw_total_all + sw_disc + svc_total

    html += f"""<table class="grand-total-table">
  <tr>
    <td style="width:70%"><strong>GRAND TOTAL</strong></td>
    <td class="gt-val">{fmt(grand)}</td>
  </tr>
</table>

<div class="terms">
  <div class="terms-title">Terms &amp; Conditions:</div>
  &bull; T/T in advance or by agreement terms;<br>
  &bull; Shipment after TT within 1&ndash;4 weeks after receipt of payment;<br>
  &bull; Prices are excluding: any taxes, duties and customs;<br>
  &bull; Delivery: Ex-works;<br>
  &bull; Hardware Warranty &ndash; 12 months from date of shipment.
</div>

<div class="doc-footer">Thank you for your business!</div>

</body></html>"""

    return html


def generate_pdf(data: dict, out_path: str) -> str:
    """Generate PDF from quotation data using WeasyPrint."""
    from weasyprint import HTML, CSS
    html_content = build_html(data)
    HTML(string=html_content, base_url=None).write_pdf(out_path)
    return out_path
