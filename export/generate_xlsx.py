"""
Generates a quotation XLSX matching the style of the original Stream Labs template:
- White background, Rubik font, dark text (40495A)
- Dark navy section headers (1D2F41)
- Thin borders in dark theme color
- Print area A:M, portrait A4
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.styles.numbers import FORMAT_NUMBER_COMMA_SEPARATED1
from openpyxl.worksheet.pagebreak import Break
from openpyxl.workbook.defined_name import DefinedName
from datetime import datetime, timedelta

# ── Style constants ──────────────────────────────────────────
C_TEXT      = "FF40495A"   # dark slate text
C_MUTED     = "FF7C85B3"   # muted text
C_SEC_BG    = "FF1D2F41"   # dark navy section headers
C_WHITE     = "FFFFFFFF"
C_NONE      = "00000000"   # transparent / white bg
C_BORDER    = "FFD0D5E0"   # border color — light grey

FONT_MAIN   = "Rubik"
FONT_ALT    = "Arial"

def _brd():
    s = Side(style="thin", color=C_BORDER)
    return Border(left=s, right=s, top=s, bottom=s)

def _brd_partial(**kwargs):
    """Build a border with only specified sides."""
    sides = {}
    for side in ("left","right","top","bottom"):
        if side in kwargs:
            sides[side] = Side(style="thin", color=C_BORDER)
        else:
            sides[side] = Side(style=None)
    return Border(**sides)

def _font(name=FONT_MAIN, size=8, bold=False, color=C_TEXT, italic=False):
    return Font(name=name, size=size, bold=bold, color=color, italic=italic)

def _fill(hex_color=C_NONE):
    if hex_color == C_NONE:
        return PatternFill(fill_type=None)
    return PatternFill("solid", fgColor=hex_color)

def _align(h="left", v="center", wrap=False, indent=0):
    return Alignment(horizontal=h, vertical=v, wrap_text=wrap,
                     indent=indent if h == "left" else 0)

def _money_fmt(currency="USD"):
    if currency == "USD":
        return '[$$-409]#,##0.00'
    return r'#,##0.00\ "€"'

def _merge_brd(ws, start_row, start_col, end_row, end_col):
    """Apply full outer border to a merged range.
    Must be called AFTER merge_cells().
    """
    s = Side(style="thin", color=C_BORDER)
    n = Side(style=None)
    for row in range(start_row, end_row + 1):
        for col in range(start_col, end_col + 1):
            is_left   = (col == start_col)
            is_right  = (col == end_col)
            is_top    = (row == start_row)
            is_bottom = (row == end_row)
            ws.cell(row, col).border = Border(
                left=s   if is_left   else n,
                right=s  if is_right  else n,
                top=s    if is_top    else n,
                bottom=s if is_bottom else n,
            )

def _row_brd(ws, row, start_col, end_col):
    """Apply full border to every cell in a single row range (no merge needed).
    Each cell gets all 4 sides — this is what makes interior borders visible.
    """
    s = Side(style="thin", color=C_BORDER)
    for col in range(start_col, end_col + 1):
        ws.cell(row, col).border = Border(left=s, right=s, top=s, bottom=s)

def _set(ws, coord, value=None, font=None, fill=None, align=None, border=None, num_fmt=None):
    c = ws[coord] if isinstance(coord, str) else ws.cell(*coord)
    if value is not None: c.value = value
    if font:   c.font      = font
    if fill:   c.fill      = fill
    if align:  c.alignment = align
    if border: c.border    = border
    if num_fmt: c.number_format = num_fmt
    return c

def _row(ws, r, col_vals, font=None, fill=None, align=None, border=None, num_fmt=None):
    """Set multiple cells in a row. col_vals: list of (col_idx, value)."""
    for col, val in col_vals:
        _set(ws, (r, col), value=val, font=font, fill=fill, align=align,
             border=border, num_fmt=num_fmt)

def _merge_set(ws, r, c1, c2, value=None, font=None, fill=None, align=None, border=None):
    ws.merge_cells(start_row=r, start_column=c1, end_row=r, end_column=c2)
    cell = ws.cell(r, c1)
    if value is not None: cell.value = value
    if font:   cell.font      = font
    if fill:   cell.fill      = fill
    if align:  cell.alignment = align
    if border: cell.border    = border
    return cell

def generate_xlsx(data: dict, out_path: str) -> str:
    currency = data.get('currency', 'USD')
    usd_rate = float(data.get('usd_rate', 1) or 1)
    wb = Workbook()
    ws = wb.active
    ws.title = "Price Quote"

    # Page setup — A4 portrait, print area A:M
    ws.page_setup.paperSize   = 9   # A4
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToPage   = True
    ws.page_setup.fitToWidth  = 1
    ws.page_setup.fitToHeight = 0   # 0 = unlimited pages vertically (manual breaks control pagination)
    # Print margins (in inches) — minimal to use more space
    ws.page_margins.left   = 0.4
    ws.page_margins.right  = 0.4
    ws.page_margins.top    = 0.4
    ws.page_margins.bottom = 0.4
    ws.page_margins.header = 0.2
    ws.page_margins.footer = 0.2
    # Print area set dynamically after content is written — placeholder updated below
    ws.sheet_view.showGridLines = False

    # ── Section-aware page break tracking ──────────────────────
    # Each entry: (header_row, last_row_of_section) — used after the sheet
    # is fully built to insert page breaks BETWEEN sections, never inside one.
    section_blocks = []

    # Column widths
    # A = narrow left margin, B = label, C:J = client value, K = right label, L:M = right value
    col_widths = {
        "A": 1.5,   # left margin
        "B": 10.0,  # client label
        "C": 8.0, "D": 8.0, "E": 8.0, "F": 6.0,
        "G": 6.0,  "H": 6.0, "I": 6.0, "J": 13.0,  # Part Number column — needs space
        "K": 13.0,  # Q'ty column header, also holds right-side labels like "Sales contact:"
        "L": 13.0, "M": 20.0,  # right value — wider M for long email addresses
        "N": 2.0,   # gap separating print area from off-print pricing block
        "O": 13.0, "P": 10.0, "Q": 13.0,  # off-print: List/Margin/Rate, Unit price
    }
    for col_letter, width in col_widths.items():
        ws.column_dimensions[col_letter].width = width

    # Column index reference:
    # A=1(margin), B=2(lbl), C-J=3-10(val), K=11(right lbl), L=12, M=13(right val L:M merged)
    # Main content columns for HW/SW/SVC sections: B-M (2-13)
    # Description: B-I (2-9), Part#: J(10), Qty: K(11), U/P: L(12), Total: M(13)

    f_hdr  = _font(size=9,  color=C_WHITE)
    f_body = _font(size=6,  color=C_TEXT)
    f_bold = _font(size=6,  color=C_TEXT, bold=True)
    f_med  = _font(size=8,  color=C_TEXT)
    f_title= _font(size=15, color=C_TEXT, bold=True)
    fill_s = _fill(C_SEC_BG)
    fill_n = _fill()
    brd    = _brd()
    al_l   = _align("left",  "center", wrap=True, indent=1)
    al_r   = _align("right", "center")
    al_c   = _align("center","center")
    money  = _money_fmt(currency)

    r = 1  # current row cursor

    # SW discount % — value captured now; the actual cell is placed later,
    # near Terms & Total, so the input sits right next to the totals it drives.
    sw_discount_pct = data.get("sw_discount", 0) or 0
    SW_DISC_CELL = None  # set once we know the row, just before Terms & Total
    wb.defined_names["SW_DISCOUNT_PCT"] = DefinedName(
        "SW_DISCOUNT_PCT", attr_text=f"'{ws.title}'!$O$1"  # placeholder, corrected below
    )

    # ── Row 1: Logo (left) + Title (right) ───────────────────
    ws.merge_cells(start_row=r, start_column=11, end_row=r, end_column=13)
    c = ws.cell(r, 11)
    c.value = "Formal Quotation"
    c.font  = f_title
    c.alignment = _align("right", "center")
    ws.row_dimensions[r].height = 50   # tall enough for logo + title
    r += 1

    # ── Rows 2-3: Date / Valid ────────────────────────────────
    date_str    = datetime.now().strftime("%d/%m/%Y")
    valid_days  = int(data.get("valid_days", 30))
    valid_until = (datetime.now() + timedelta(days=valid_days)).strftime("%d/%m/%Y")

    def _right_row(ws, rr, lbl, val, val_bold=False):
        """Label in K(11) right-aligned, value merged L:M(12:13) right-aligned, full border."""
        s = Side(style="thin", color=C_BORDER)
        full_brd = Border(left=s, right=s, top=s, bottom=s)
        half_l   = Border(left=s, top=s, bottom=s)   # anchor after merge
        half_r   = Border(right=s, top=s, bottom=s)  # last cell after merge
        # Label
        c_lbl = ws.cell(rr, 11)
        c_lbl.value     = lbl
        c_lbl.font      = _font(size=7, color=C_MUTED, bold=True)
        c_lbl.border    = full_brd
        c_lbl.alignment = _align("right", "center")
        # Merge L:M for value
        ws.merge_cells(start_row=rr, start_column=12, end_row=rr, end_column=13)
        c_val = ws.cell(rr, 12)
        c_val.value     = val
        c_val.font      = _font(size=8, color=C_TEXT, bold=val_bold)
        c_val.alignment = _align("right", "center", indent=1)
        c_val.border    = half_l
        ws.cell(rr, 13).border = half_r
        ws.row_dimensions[rr].height = 12

    _right_row(ws, r, "Date:",  date_str);   r += 1
    _right_row(ws, r, "Valid:", valid_until); r += 1

    # ── Row 4: Bill To / Quote ID ─────────────────────────────
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
    ws.cell(r,2).value = "Bill To:"; ws.cell(r,2).font = _font(size=9,color=C_WHITE)
    ws.cell(r,2).fill = fill_s; ws.cell(r,2).alignment = al_l
    _row_brd(ws, r, 2, 9)
    _right_row(ws, r, "Quote ID:", data.get("quote_id",""), val_bold=True)
    ws.row_dimensions[r].height = 12
    r += 1

    # ── Rows 5-10: Client fields + right meta ─────────────────
    client_fields = [
        ("Company:",  data.get("company","")),
        ("Address:",  data.get("address","")),
        ("Country:",  data.get("country","")),
        ("Contact:",  data.get("contact","")),
        ("Phone:",    data.get("phone","")),
        ("Email:",    data.get("email","")),
    ]
    meta_right = [
        ("Signed by:",     data.get("signed_by","")),
        ("Sales contact:", data.get("sales_contact","")),
        ("Sales email:",   data.get("sales_email","")),
        None, None, None,
    ]
    for i, (lbl, val) in enumerate(client_fields):
        rr    = r + i
        top_b = (i == 0)
        bot_b = (i == 5)
        s_top = Side(style="thin", color=C_BORDER) if top_b else Side(style=None)
        s_bot = Side(style="thin", color=C_BORDER) if bot_b else Side(style=None)
        s_sid = Side(style="thin", color=C_BORDER)

        # Label cell B
        _set(ws, (rr,2), lbl,
             font=_font(size=7, color=C_MUTED, bold=True),
             border=Border(left=s_sid, right=s_sid, top=s_top, bottom=s_bot),
             align=al_l)

        # Value cells C:I merged (extended from C:G)
        ws.merge_cells(start_row=rr, start_column=3, end_row=rr, end_column=9)
        _set(ws, (rr,3), val,
             font=_font(size=8, color=C_TEXT, bold=(i==0)),
             border=Border(left=s_sid, right=s_sid, top=s_top, bottom=s_bot),
             align=al_l)
        # Explicit right border on last merged cell (col 9) after merge
        ws.cell(rr, 9).border = Border(
            right=s_sid, top=s_top, bottom=s_bot)
        # Ensure left+right border on label cell B
        ws.cell(rr, 2).border = Border(
            left=s_sid, right=s_sid, top=s_top, bottom=s_bot)

        # Right meta
        rmeta = meta_right[i]
        if rmeta:
            _right_row(ws, rr, rmeta[0], rmeta[1])
        ws.row_dimensions[rr].height = 12
    r += 6

    # ── Row: Office / Summary ─────────────────────────────────
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
    ws.cell(r,2).value = "Office:"; ws.cell(r,2).font = f_hdr
    ws.cell(r,2).fill = fill_s; ws.cell(r,2).alignment = al_l
    _row_brd(ws, r, 2, 4)
    ws.merge_cells(start_row=r, start_column=5, end_row=r, end_column=13)
    ws.cell(r,5).value = "Summary:"; ws.cell(r,5).font = f_hdr
    ws.cell(r,5).fill = fill_s; ws.cell(r,5).alignment = al_l
    _row_brd(ws, r, 5, 13)
    ws.row_dimensions[r].height = 14
    r += 1

    co = data.get("_company", {})
    OFFICE = "\n".join(filter(None, [
        co.get("name", "SIA STREAM LABS (EUROPE)"),
        "ADDRESS: " + co.get("address", "Siguldas 37, Daugavpils, LV-5417"),
        ("EU VAT ID: " + co.get("vat")) if co.get("vat") else "",
    ]))
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
    ws.cell(r,2).value = OFFICE; ws.cell(r,2).font = _font(size=7,color=C_TEXT)
    ws.cell(r,2).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
    _row_brd(ws, r, 2, 4)
    ws.merge_cells(start_row=r, start_column=5, end_row=r, end_column=13)
    summary_text = data.get("summary","")
    ws.cell(r,5).value = f"\n{summary_text}\n" if summary_text else ""
    ws.cell(r,5).font = _font(size=7,color=C_TEXT)
    ws.cell(r,5).alignment = Alignment(horizontal="left", vertical="top", wrap_text=True, indent=1)
    _row_brd(ws, r, 5, 13)
    # Auto-height: ~100 chars per line at this width/font, +2 lines for top/bottom padding
    sum_lines = max(1, sum(-(-len(ln) // 100) for ln in (summary_text or "").split("\n"))) + 2
    ws.row_dimensions[r].height = max(36, sum_lines * 10)

    # Logo — top-left at B1, same level as "Formal Quotation" title
    logo_file = co.get("logo", "")
    if logo_file:
        import os as _os
        logo_path = _os.path.join(_os.path.dirname(_os.path.dirname(__file__)),
                                   "data", "assets", logo_file)
        if _os.path.exists(logo_path):
            from openpyxl.drawing.image import Image as XLImage
            try:
                img = XLImage(logo_path)
                img.width, img.height = 180, 60
                img.anchor = "B1"
                ws.add_image(img)
            except Exception:
                pass
    r += 1

    # ────────────────────────────────────────────────────────
    # ── HARDWARE (only if items present) ─────────────────────
    # ────────────────────────────────────────────────────────
    hw_hdr_row   = r
    hw_total_cells = []
    if data.get("hardware"):
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
        ws.cell(r,2).value = "Hardware"; ws.cell(r,2).font = f_hdr
        ws.cell(r,2).fill = fill_s; ws.cell(r,2).alignment = al_l
        _row_brd(ws, r, 2, 9)
        for col in [10,11,12,13]:
            hdrs = {10:"Part Number", 11:"Q'ty", 12:"U/P", 13:"Total"}
            _set(ws, (r,col), hdrs[col], font=f_hdr, fill=fill_s, border=brd, align=al_c)
        ws.row_dimensions[r].height = 16.5
        r += 1

        # Off-print pricing block header (col O/P)
        ws.cell(r-1, 15).value = "List $"
        ws.cell(r-1, 16).value = "Margin %"
        for c in (15,16):
            ws.cell(r-1, c).font = _font(size=7, color=C_MUTED, bold=True)

        hw_data_start = r
        for hw in data.get("hardware", []):
            from openpyxl.cell.rich_text import TextBlock, CellRichText
            from openpyxl.cell.text import InlineFont
            title_text  = hw.get("desc","")
            detail_text = hw.get("detail","")
            if detail_text:
                bold_f = InlineFont(rFont="Rubik", sz=6, b=True,  color=C_TEXT)
                rest_f = InlineFont(rFont="Rubik", sz=6, b=False, color=C_TEXT)
                nl_f   = InlineFont(rFont="Rubik", sz=6, b=False, color=C_TEXT)
                cell_val = CellRichText([
                    TextBlock(bold_f, title_text),
                    TextBlock(rest_f, "\n" + detail_text),
                ])
            else:
                cell_val = title_text
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
            ws.cell(r, 2).value     = cell_val
            ws.cell(r, 2).font      = _font(size=6, color=C_TEXT, bold=not detail_text)
            ws.cell(r, 2).fill      = fill_n
            ws.cell(r, 2).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
            _row_brd(ws, r, 2, 9)
            _set(ws, (r,10), hw.get("pn",""), font=f_body, fill=fill_n, border=brd, align=al_c)
            _set(ws, (r,11), hw.get("qty",1), font=f_body, fill=fill_n, border=brd, align=al_c)

            # Off-print: List price (O), Margin % (P) — raw inputs
            list_price = hw.get("list_price", 0) or 0
            margin     = hw.get("margin", 0) or 0
            ws.cell(r,15).value = list_price
            ws.cell(r,15).number_format = _money_fmt(currency)
            ws.cell(r,16).value = margin / 100
            ws.cell(r,16).number_format = "0%"
            for c in (15,16):
                ws.cell(r,c).font = _font(size=7, color=C_MUTED)

            # Unit Price L (12) — visible in-table cell, formula linking to off-print O/P
            ws.cell(r,12).value          = f"=O{r}*(1+P{r})"
            ws.cell(r,12).font           = f_body
            ws.cell(r,12).fill           = fill_n
            ws.cell(r,12).alignment      = al_r
            ws.cell(r,12).number_format  = _money_fmt(currency)
            ws.cell(r,12).border         = brd

            # Total (M) = Qty × Unit price (L, visible)
            total_ref = f"=K{r}*L{r}"
            _set(ws, (r,13), total_ref, font=f_body, fill=fill_n, border=brd, align=al_r, num_fmt=_money_fmt(currency))
            hw_total_cells.append(f"M{r}")
            ws.row_dimensions[r].height = 40
            r += 1
        hw_data_end = r - 1
        section_blocks.append((hw_hdr_row, hw_data_end))
    if data.get("hardware"):
        section_blocks.append((hw_hdr_row, hw_data_end))

    # ────────────────────────────────────────────────────────
    # ── SOFTWARE LICENSES ────────────────────────────────────
    # ────────────────────────────────────────────────────────
    sw_section_total_refs = []

    # Several products → one Total cell for all of them: L:M is merged from the first
    # product's first row down to the last product's last row, across the headers between.
    lic_groups   = [g for g in data.get("licenses", []) if g.get("items")]
    combine_lic  = len(lic_groups) > 1
    lic_first_hdr   = None   # header row of the first product
    lic_total_start = None   # first row of the shared Total cell
    lic_item_ranges = []     # (sw_start, sw_end) per product, for the shared SUMPRODUCT

    for gidx, lic_group in enumerate(lic_groups):
        items = lic_group.get("items", [])
        n_items = len(items)
        in_shared_total = combine_lic and gidx > 0   # header L:M is covered by the shared Total

        lic_hdr_row = r
        if lic_first_hdr is None: lic_first_hdr = r
        # Section header — col headers: Part Number | Qty | Total (no List/Discounted split)
        sec_label = ((lic_group.get("section_label") or "").strip()
                     or f"Monitoring and alarming licenses — {lic_group['name']}")
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
        ws.cell(r,2).value = sec_label; ws.cell(r,2).font = f_hdr
        ws.cell(r,2).fill = fill_s; ws.cell(r,2).alignment = al_l
        _row_brd(ws, r, 2, 9)
        if in_shared_total:
            for col, lbl in {10:"Part Number", 11:"Q'ty"}.items():
                _set(ws, (r,col), lbl, font=f_hdr, fill=fill_s, border=brd, align=al_c)
        else:
            ws.merge_cells(start_row=r, start_column=12, end_row=r, end_column=13)
            for col, lbl in {10:"Part Number", 11:"Q'ty", 12:"Total"}.items():
                _set(ws, (r,col), lbl, font=f_hdr, fill=fill_s, border=brd, align=al_c)
            ws.cell(r,13).fill = fill_s
            ws.cell(r,13).border = brd
        ws.row_dimensions[r].height = 16.5
        r += 1

        # ── Product description — one wide row spanning B:K, right under the header ──
        s_brd  = Side(style="thin", color=C_BORDER)
        s_none = Side(style=None)
        prod_desc  = (lic_group.get("description") or "").strip()
        prod_logo  = (lic_group.get("logo") or "").strip()
        show_logos = data.get("show_logos", False)
        desc_row = None

        if prod_desc or (prod_logo and show_logos):
            desc_row = r
            has_logo = bool(prod_logo and show_logos)
            # Logo occupies B only (col 2), text starts from C (col 3) — tight layout
            # Without logo, text spans full B:K as before
            text_start_col = 3 if has_logo else 2
            ws.merge_cells(start_row=r, start_column=text_start_col, end_row=r, end_column=11)

            if prod_desc:
                lines = prod_desc.split("\n")
                first_line = lines[0]
                rest_text  = "\n".join(lines[1:]) if len(lines) > 1 else ""
                from openpyxl.cell.rich_text import TextBlock, CellRichText
                from openpyxl.cell.text import InlineFont
                if rest_text:
                    bold_f = InlineFont(rFont="Rubik", sz=7, b=True,  color=C_MUTED)
                    rest_f = InlineFont(rFont="Rubik", sz=7, b=False, color=C_MUTED)
                    ws.cell(r, text_start_col).value = CellRichText([
                        TextBlock(bold_f, first_line),
                        TextBlock(rest_f, "\n" + rest_text),
                    ])
                else:
                    ws.cell(r, text_start_col).value = first_line
                ws.cell(r, text_start_col).font = _font(size=7, color=C_MUTED, bold=(not rest_text))
            ws.cell(r, text_start_col).fill      = fill_n
            ws.cell(r, text_start_col).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
            _row_brd(ws, r, text_start_col, 11)

            # Product logo — B:C (cols 2-3), left of description, centered
            if has_logo:
                import os as _os
                _here     = _os.path.abspath(_os.path.dirname(__file__))
                logo_path = _os.path.join(_os.path.dirname(_here), "data", "assets", prod_logo)
                ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=2)  # B only
                ws.cell(r, 2).fill = fill_n
                # No right border so logo blends into text cell
                ws.cell(r, 2).border = Border(
                    left=s_brd, right=s_none, top=s_brd, bottom=s_none
                )
                # Remove left border of text cell so there's no dividing line
                tc = ws.cell(r, text_start_col)
                tc.border = Border(
                    left=s_none,
                    right=tc.border.right if tc.border else s_brd,
                    top=s_brd, bottom=s_none,
                )
                if _os.path.exists(logo_path):
                    from openpyxl.drawing.image import Image as XLImage
                    try:
                        pimg = XLImage(logo_path)
                        pimg.width, pimg.height = 70, 70
                        pimg.anchor = f"B{r}"
                        ws.add_image(pimg)
                    except Exception:
                        pass

            # L+M spacer — borders only (Total merge absorbs these)
            for col in (12, 13):
                ws.cell(r, col).fill = fill_n
                ws.cell(r, col).border = Border(
                    left=s_brd  if col == 12 else s_none,
                    right=s_brd if col == 13 else s_none,
                    top=s_brd, bottom=s_none,
                )

            # Row height
            if has_logo:
                ws.row_dimensions[r].height = 65
            elif prod_desc:
                CHARS_PER_LINE = 108
                lines2 = prod_desc.split("\n")
                total_chars = sum(max(1, -(-len(ln) // CHARS_PER_LINE)) for ln in lines2) if lines2 else 1
                ws.row_dimensions[r].height = max(16, max(1, total_chars) * 11 + 8)
            r += 1

        # Off-print pricing block header
        ws.cell(r-1, 15).value = "Unit $"
        ws.cell(r-1, 15).font  = _font(size=7, color=C_MUTED, bold=True)

        # License rows — description B:I, code J, qty K, unit price (off-print O), total M
        sw_start = r

        for idx, item in enumerate(items):
            is_first = (idx == 0)
            is_last  = (idx == n_items - 1)

            # Description B:I — full border on every cell
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
            desc_text = item.get("desc_short", item.get("desc",""))
            ws.cell(r,2).value     = desc_text
            ws.cell(r,2).font      = f_body
            ws.cell(r,2).fill      = fill_n
            ws.cell(r,2).alignment = _align("left","center",wrap=True, indent=1)
            _row_brd(ws, r, 2, 9)

            # Code J (10) and Qty K (11) — full border every row
            _set(ws, (r,10), item.get("code",""), font=f_body, fill=fill_n, border=brd, align=al_c)
            _set(ws, (r,11), item.get("qty",0),   font=f_body, fill=fill_n, border=brd, align=al_c)

            # L+M spacer per row — left/right border only, top/bottom only on first/last
            # (the group total below will merge the FULL L:M block across all rows)
            for col in (12, 13):
                ws.cell(r, col).fill = fill_n
                ws.cell(r, col).border = Border(
                    left=s_brd  if col == 12 else s_none,
                    right=s_brd if col == 13 else s_none,
                    top=s_brd if is_first else s_none,
                    bottom=s_brd if is_last else s_none,
                )

            # Unit price — off-print column O (15)
            price = item.get("price", 0) or 0
            ws.cell(r, 15).value          = price
            ws.cell(r, 15).font           = _font(size=7, color=C_MUTED)
            ws.cell(r, 15).alignment      = al_r
            ws.cell(r, 15).number_format  = _money_fmt(currency)

            ws.row_dimensions[r].height = 22.5
            r += 1

        sw_end = r - 1
        total_merge_start = desc_row if desc_row is not None else sw_start

        if combine_lic:
            if lic_total_start is None: lic_total_start = total_merge_start
            lic_item_ranges.append((sw_start, sw_end))
            continue

        # Group total — merged L:M across description row (if any) + all item rows
        if n_items > 0:
            ws.merge_cells(start_row=total_merge_start, start_column=12,
                           end_row=sw_end,                end_column=13)

            c = ws.cell(total_merge_start, 12)
            c.value          = f"=SUMPRODUCT(K{sw_start}:K{sw_end},O{sw_start}:O{sw_end})"
            c.font           = _font(size=9, color=C_TEXT, bold=False)
            c.alignment      = _align("right", "center", indent=1)
            c.number_format  = _money_fmt(currency)
            c.border         = Border(left=s_brd, right=s_brd,
                                      top=s_brd, bottom=s_brd)
            ws.cell(sw_end, 13).border = Border(right=s_brd, bottom=s_brd)

            # Discounted value for this group, as a formula referencing the
            # list total and the global SW_DISCOUNT_PCT cell (editable in Excel)
            disc_cell_ref = f"L{total_merge_start}*(1-SW_DISCOUNT_PCT)"
            sw_section_total_refs.append(disc_cell_ref)

        section_blocks.append((lic_hdr_row, sw_end))

    # Shared Total for several products — one merged L:M cell, one SUMPRODUCT per product
    if combine_lic:
        s_brd   = Side(style="thin", color=C_BORDER)
        lic_end = lic_item_ranges[-1][1]
        ws.merge_cells(start_row=lic_total_start, start_column=12,
                       end_row=lic_end,           end_column=13)
        c = ws.cell(lic_total_start, 12)
        c.value          = "=" + "+".join(f"SUMPRODUCT(K{a}:K{b},O{a}:O{b})" for a, b in lic_item_ranges)
        c.font           = _font(size=9, color=C_TEXT, bold=False)
        c.alignment      = _align("right", "center", indent=1)
        c.number_format  = _money_fmt(currency)
        c.fill           = fill_n
        c.border         = Border(left=s_brd, right=s_brd, top=s_brd, bottom=s_brd)
        ws.cell(lic_end, 13).border = Border(right=s_brd, bottom=s_brd)
        sw_section_total_refs.append(f"L{lic_total_start}*(1-SW_DISCOUNT_PCT)")
        # One block, so a page break never splits the shared Total cell
        section_blocks.append((lic_first_hdr, lic_end))

    # ────────────────────────────────────────────────────────
    # ── SERVICES ─────────────────────────────────────────────
    # ────────────────────────────────────────────────────────
    svc_hdr_row = r
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
    ws.cell(r,2).value = "Support, Warranty, Installation & other services"
    ws.cell(r,2).font = f_hdr; ws.cell(r,2).fill = fill_s; ws.cell(r,2).alignment = al_l
    _row_brd(ws, r, 2, 9)
    for col, lbl in {10:"", 11:"Q'ty", 12:"U/P", 13:"Total"}.items():
        _set(ws, (r,col), lbl, font=f_hdr, fill=fill_s, border=brd, align=al_c)
    ws.row_dimensions[r].height = 16.5
    r += 1

    # Off-print pricing block header for Services
    ws.cell(r-1, 15).value = "SLA base"
    ws.cell(r-1, 16).value = "Rate %"
    ws.cell(r-1, 17).value = "Unit $"
    for c in (15,16,17):
        ws.cell(r-1, c).font = _font(size=7, color=C_MUTED, bold=True)

    # Pre-build full SW-discounted-total and HW-total formulas (sums across all groups/rows)
    sw_full_formula = "(" + "+".join(f"({ref})" for ref in sw_section_total_refs) + ")" if sw_section_total_refs else "0"
    hw_full_formula = f"SUM({','.join(hw_total_cells)})" if hw_total_cells else "0"

    svc_start = r
    svc_cells = []
    s_brd = Side(style="thin", color=C_BORDER)
    for svc_idx, svc in enumerate(data.get("services",[])):
        if not svc.get("desc","").strip():
            continue
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
        raw_desc = svc.get("desc","")
        lines = raw_desc.split("\n")
        from openpyxl.cell.rich_text import TextBlock, CellRichText
        from openpyxl.cell.text import InlineFont
        rest_text = "\n".join(lines[1:]) if len(lines) > 1 else ""
        if rest_text:
            bold_f = InlineFont(rFont="Rubik", sz=6, b=True,  color=C_TEXT)
            rest_f = InlineFont(rFont="Rubik", sz=6, b=False, color=C_TEXT)
            ws.cell(r,2).value = CellRichText([
                TextBlock(bold_f, lines[0]),
                TextBlock(rest_f, "\n" + rest_text),
            ])
        else:
            ws.cell(r,2).value = lines[0]
        # Always set cell font — Excel uses this as fallback size for rich text
        ws.cell(r,2).font      = _font(size=6, color=C_TEXT, bold=(not rest_text))
        ws.cell(r,2).fill      = fill_n
        ws.cell(r,2).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
        _row_brd(ws, r, 2, 9)
        # col 10 empty with border
        ws.cell(r,10).border = brd
        _set(ws,(r,11), svc.get("qty",1), font=f_body, fill=fill_n, border=brd, align=al_c)

        # Off-print pricing detail (O/P/Q)
        if svc.get("is_sla_formula"):
            use_sw = svc.get("sla_use_sw", False)
            use_hw = svc.get("sla_use_hw", False)
            rate   = svc.get("sla_rate", 0) or 0
            base_parts = []
            if use_sw: base_parts.append(sw_full_formula)
            if use_hw: base_parts.append(hw_full_formula)
            base_formula = "+".join(base_parts) if base_parts else "0"
            ws.cell(r,15).value = f"={base_formula}"
            ws.cell(r,15).number_format = _money_fmt(currency)
            ws.cell(r,16).value = rate / 100
            ws.cell(r,16).number_format = "0%"
            ws.cell(r,17).value = f"=O{r}*P{r}"
            ws.cell(r,17).number_format = _money_fmt(currency)
        else:
            # Manual price — still placed in Q so Total formula stays consistent
            ws.cell(r,15).value = ""
            ws.cell(r,16).value = ""
            ws.cell(r,17).value = svc.get("unit_price", 0) or 0
            ws.cell(r,17).number_format = _money_fmt(currency)
        for c in (15,16,17):
            ws.cell(r,c).font = _font(size=7, color=C_MUTED)

        # Unit Price L (12) — visible in-table cell, formula linking to off-print Q
        ws.cell(r,12).value          = f"=Q{r}"
        ws.cell(r,12).font           = f_body
        ws.cell(r,12).fill           = fill_n
        ws.cell(r,12).alignment      = al_r
        ws.cell(r,12).number_format  = _money_fmt(currency)
        ws.cell(r,12).border         = brd

        _set(ws,(r,13), f"=K{r}*L{r}", font=f_body, fill=fill_n, border=brd, align=al_r, num_fmt=_money_fmt(currency))
        svc_cells.append(f"M{r}")
        # Auto-height based on line count in description
        desc_text = svc.get("desc","")
        line_count = max(1, desc_text.count("\n") + 1)
        ws.row_dimensions[r].height = max(22, line_count * 11 + 6)
        r += 1
    svc_end = r - 1
    if data.get("services"):
        section_blocks.append((svc_hdr_row, svc_end))

    # ────────────────────────────────────────────────────────
    # ── TERMS & TOTAL ─────────────────────────────────────────
    # ────────────────────────────────────────────────────────
    terms_hdr_row = r
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=13)
    ws.cell(r,2).value = "Terms & Total:"; ws.cell(r,2).font = f_hdr
    ws.cell(r,2).fill = fill_s; ws.cell(r,2).alignment = al_l
    _row_brd(ws, r, 2, 13)
    ws.row_dimensions[r].height = 16.5
    r += 1

    TERMS = (
        " \u2022 T/T in advance or by agreement terms;\n"
        " \u2022 Shipment after TT within 1-4 weeks after receipt;\n"
        " \u2022 Prices are excluding: any taxes, duties and customs;\n"
        " \u2022 Delivery: Ex-works\n"
        " \u2022 Hardware Warranty \u2013 12 months from date of shipment;"
    )
    show_both  = data.get("show_both", False) and currency == "USD"
    terms_rows = 5 + (1 if show_both else 0)   # extra row for EUR total
    terms_r = r
    ws.merge_cells(start_row=r, start_column=2, end_row=r+terms_rows-1, end_column=10)
    ws.cell(r,2).value     = TERMS
    ws.cell(r,2).font      = _font(size=8, color=C_TEXT)
    ws.cell(r,2).fill      = fill_n
    ws.cell(r,2).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
    _merge_brd(ws, r, 2, r+terms_rows-1, 10)

    # ── SW Discount % — editable cell, off-print, next to Terms & Total ──
    # Placed here (not at the top of the sheet) so the input sits right next
    # to "Software:" — the first total that depends on it.
    sw_disc_row = terms_r
    ws.cell(sw_disc_row, 14).value = "SW Discount %"
    ws.cell(sw_disc_row, 14).font  = _font(size=8, color=C_MUTED, bold=True)
    ws.cell(sw_disc_row, 14).alignment = al_r
    ws.cell(sw_disc_row, 15).value = sw_discount_pct / 100
    ws.cell(sw_disc_row, 15).font  = _font(size=10, color=C_TEXT, bold=True)
    ws.cell(sw_disc_row, 15).number_format = "0%"
    ws.cell(sw_disc_row, 15).fill  = _fill("FFFFF3CD")  # light amber — signals "editable input"
    ws.cell(sw_disc_row, 15).border = _brd()
    ws.cell(sw_disc_row, 15).alignment = al_c
    # Correct the named range to point at this actual cell
    wb.defined_names["SW_DISCOUNT_PCT"] = DefinedName(
        "SW_DISCOUNT_PCT", attr_text=f"'{ws.title}'!$O${sw_disc_row}"
    )

    # Discounted Software total — sum of each group's discounted-cell-formula
    if sw_section_total_refs:
        sw_disc_formula = "=" + "+".join(f"({ref})" for ref in sw_section_total_refs)
    else:
        sw_disc_formula = "=0"

    # List total (before discount) — sum of each group's M-column SUMPRODUCT cell
    sw_list_refs = [ref.split("*(1-")[0] for ref in sw_section_total_refs]  # "M{row}" part
    sw_list_formula = "=" + "+".join(sw_list_refs) if sw_list_refs else "=0"

    hw_total_val  = f"=SUM({','.join(hw_total_cells)})" if hw_total_cells else "=0"
    svc_total_val = f"=SUM({','.join(svc_cells)})"      if svc_cells      else "=0"

    totals = [
        ("Software:", sw_disc_formula),
        ("Hardware:",            hw_total_val),
        ("Services:",            svc_total_val),
        ("Discount:",            None),  # filled in below — formula referencing list vs discounted
        ("Discounted Total USD:" if show_both else "Discounted Total:", None),
    ]
    total_rows = {}
    for i, (lbl, val) in enumerate(totals):
        rr = r + i
        total_rows[lbl] = rr
        ws.merge_cells(start_row=rr, start_column=11, end_row=rr, end_column=12)
        is_discount = (lbl == "Discount:")
        bold_total  = lbl.startswith("Discounted Total")
        lbl_color   = "FFCC0000" if is_discount else C_TEXT
        val_color   = "FFCC0000" if is_discount else C_TEXT
        ws.cell(rr,11).value     = lbl
        ws.cell(rr,11).font      = _font(size=9, color=lbl_color, bold=bold_total)
        ws.cell(rr,11).fill      = fill_n
        ws.cell(rr,11).alignment = al_r
        _row_brd(ws, rr, 11, 12)

        if lbl == "Discount:":
            sw_row = total_rows.get("Software:", rr-3)
            # Discount = list total − discounted total (negative, shown in red)
            formula = f"=-(({sw_list_formula[1:]})-M{sw_row})"
            _set(ws,(rr,13), formula,
                 font=_font(size=9, color=val_color, bold=bold_total),
                 fill=fill_n, border=brd, align=al_r, num_fmt=_money_fmt(currency))
        elif bold_total:
            sw_row  = total_rows.get("Software:", rr-4)
            hw_r    = total_rows.get("Hardware:",  rr-3)
            svc_r   = total_rows.get("Services:",  rr-2)
            grand_formula = f"=M{sw_row}+M{hw_r}+M{svc_r}"
            _set(ws,(rr,13), grand_formula,
                 font=_font(size=9, color=C_TEXT, bold=True),
                 fill=fill_n, border=brd, align=al_r, num_fmt=_money_fmt(currency))
        else:
            _set(ws,(rr,13), val, font=_font(size=9, color=val_color, bold=bold_total),
                 fill=fill_n, border=brd, align=al_r, num_fmt=_money_fmt(currency))
        ws.row_dimensions[rr].height = 15

    r += 5

    # Extra EUR row when showing both currencies
    if show_both:
        grand_usd_row = r - 1  # row of Discounted Total USD
        eur_lbl = "Discounted Total EUR:"
        ws.merge_cells(start_row=r, start_column=11, end_row=r, end_column=12)
        ws.cell(r,11).value     = eur_lbl
        ws.cell(r,11).font      = _font(size=9, color=C_TEXT, bold=True)
        ws.cell(r,11).fill      = fill_n
        ws.cell(r,11).alignment = al_r
        _row_brd(ws, r, 11, 12)
        # EUR = USD total / rate
        eur_formula = f"=M{grand_usd_row}/{usd_rate}"
        _set(ws,(r,13), eur_formula,
             font=_font(size=9, color=C_TEXT, bold=True),
             fill=fill_n, border=brd, align=al_r,
             num_fmt=r'#,##0.00\ "€"')
        ws.row_dimensions[r].height = 15
        r += 1
    # ── Footer ────────────────────────────────────────────────
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=13)
    ws.cell(r,2).value     = "Thank you for your business!"
    ws.cell(r,2).font      = _font(size=10, color=C_TEXT)
    ws.cell(r,2).fill      = fill_n
    ws.cell(r,2).alignment = al_c
    _row_brd(ws, r, 2, 13)
    ws.row_dimensions[r].height = 19.5
    section_blocks.append((terms_hdr_row, r))
    last_row = ws.max_row
    for row in range(ws.max_row, 0, -1):
        if any(ws.cell(row, col).value is not None for col in range(1, 14)):
            last_row = row
            break
    ws.print_area = f"A1:M{last_row}"
    # Columns N onward (pricing detail: List/Margin/Rate/Unit price) sit outside
    # the print area, so they never appear on a printed page or PDF export —
    # but remain fully visible and editable when the file is opened in Excel.

    # ── Section-aware page breaks ───────────────────────────────
    # Excel's auto pagination cuts wherever the page happens to end, splitting
    # a Hardware/License/Services block across two pages. Instead, walk through
    # each section in order, track how much vertical space (in points) is used
    # on the current page, and insert an explicit row break BEFORE a section
    # that would otherwise overflow — pushing that whole section to the next
    # page intact rather than letting it get cut mid-table.
    if section_blocks:
        # A4 page height (portrait) ≈ 842pt; subtract top+bottom margins (0.4" each = 28.8pt each)
        # plus header/footer reserve (0.2" each = 14.4pt each), then a 5% safety margin to
        # absorb small rendering differences between Excel/LibreOffice.
        PAGE_HEIGHT_PT = (842 - (28.8 * 2) - (14.4 * 2)) * 0.95

        def _row_height(row_idx):
            rd = ws.row_dimensions.get(row_idx)
            return rd.height if (rd and rd.height) else 15  # default Excel row height

        page_used = 0.0
        prev_section_end = 0
        for (sec_start, sec_end) in section_blocks:
            # Height consumed by the gap since the previous section (if any) plus this section
            gap_rows = range(prev_section_end + 1, sec_start) if prev_section_end else range(1, sec_start)
            section_height = sum(_row_height(rr) for rr in range(sec_start, sec_end + 1))
            gap_height = sum(_row_height(rr) for rr in gap_rows) if prev_section_end else 0

            if prev_section_end and (page_used + gap_height + section_height > PAGE_HEIGHT_PT):
                # Doesn't fit on current page — break before this section starts
                ws.row_breaks.append(Break(id=sec_start - 1))
                page_used = section_height
            else:
                page_used += gap_height + section_height

            prev_section_end = sec_end

    # ── Sheet 2: Server Configuration (only if the quote has hardware) ──
    # The Configurator keeps its servers after hardware rows are removed from the quote,
    # so server_config alone doesn't mean the client is buying them.
    server_config = data.get("server_config", [])
    if server_config and data.get("hardware"):
        _add_server_config_sheet(wb, server_config)

    wb.save(out_path)
    return out_path


def _add_server_config_sheet(wb, server_config, table_text=""):
    """Add a second sheet with server configuration as a 3-column table:
    Component | Value / Model | Qty
    One block per server, matching the Configurator's Build Table output.
    """
    if not server_config:
        return

    ws2 = wb.create_sheet("Server Configuration")
    ws2.sheet_view.showGridLines = False

    ws2.column_dimensions["A"].width = 1.5   # left margin
    ws2.column_dimensions["B"].width = 20    # Component category
    ws2.column_dimensions["C"].width = 55    # Value / Model
    ws2.column_dimensions["D"].width = 8     # Qty

    s      = Side(style="thin", color=C_BORDER)
    brd    = Border(left=s, right=s, top=s, bottom=s)
    fill_s = _fill(C_SEC_BG)
    f_hdr  = _font(size=9,  color="FFFFFFFF", bold=True)
    f_col  = _font(size=8,  color=C_MUTED,    bold=True)
    f_lbl  = _font(size=8,  color=C_MUTED)
    f_val  = _font(size=8,  color=C_TEXT)
    al_l   = _align("left",   "center", indent=1)
    al_c   = _align("center", "center")

    r = 1
    # Page title
    ws2.cell(r, 2).value     = "Server Configuration"
    ws2.cell(r, 2).font      = _font(size=13, color=C_TEXT, bold=True)
    ws2.cell(r, 2).alignment = al_l
    ws2.row_dimensions[r].height = 24
    r += 1

    for srv in server_config:
        comps = srv.get("components", [])
        if not comps:
            continue

        # ── Server name header ──
        ws2.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
        ws2.cell(r,2).value     = f"{srv.get('name','Server')}  (Qty: {srv.get('qty',1)})"
        ws2.cell(r,2).font      = f_hdr
        ws2.cell(r,2).fill      = fill_s
        ws2.cell(r,2).alignment = al_l
        _row_brd(ws2, r, 2, 4)
        ws2.row_dimensions[r].height = 16
        r += 1

        # ── Column headers ──
        for col, lbl in {2: "Component", 3: "Value / Model", 4: "Qty"}.items():
            ws2.cell(r, col).value     = lbl
            ws2.cell(r, col).font      = f_col
            ws2.cell(r, col).fill      = _fill("FF222540")
            ws2.cell(r, col).alignment = al_l if col < 4 else al_c
            ws2.cell(r, col).border    = brd
        ws2.row_dimensions[r].height = 13
        r += 1

        # ── Component rows ──
        for idx, comp in enumerate(comps):
            bg = _fill() if idx % 2 == 0 else _fill("FFF4F6FB")

            # Category (B)
            ws2.cell(r, 2).value     = comp.get("category", "")
            ws2.cell(r, 2).font      = f_lbl
            ws2.cell(r, 2).fill      = bg
            ws2.cell(r, 2).alignment = al_l
            ws2.cell(r, 2).border    = brd

            # Value / Model (C) — strip leading qty prefix like "4× " for display
            raw_val = comp.get("value", "")
            import re as _re
            m = _re.match(r'^(\d+)[×x]\s+(.+)$', raw_val)
            if m:
                qty_str = m.group(1)
                val_str = m.group(2)
            else:
                qty_str = "1"
                val_str = raw_val

            ws2.cell(r, 3).value     = val_str
            ws2.cell(r, 3).font      = f_val
            ws2.cell(r, 3).fill      = bg
            ws2.cell(r, 3).alignment = _align("left", "center", wrap=True, indent=1)
            ws2.cell(r, 3).border    = brd

            # Qty (D)
            ws2.cell(r, 4).value     = int(qty_str) if qty_str.isdigit() else qty_str
            ws2.cell(r, 4).font      = f_val
            ws2.cell(r, 4).fill      = bg
            ws2.cell(r, 4).alignment = al_c
            ws2.cell(r, 4).border    = brd

            ws2.row_dimensions[r].height = 14
            r += 1

        r += 1  # blank row between servers

