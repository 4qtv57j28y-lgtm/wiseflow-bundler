"""
PDF generation engine.

Personal data handling:
  - Student data exists only during active generation (local variables)
  - Template written to tmpfile with delete=True — guaranteed cleanup via finally
  - progress_cb called with counts only — caller must not log the name argument
  - summary returned contains only counts — no names, numbers, or content
"""

import io, os, re, tempfile, zipfile
from typing import Callable

from pypdf import PdfReader, PdfWriter
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas as rl_canvas

try:
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextBox
    HAS_PDFMINER = True
except ImportError:
    HAS_PDFMINER = False

CARD_STROKE = HexColor("#cccccc")
SCORE_BLUE  = HexColor("#1565c0")
TEXT_DARK   = HexColor("#111111")
TEXT_MID    = HexColor("#444444")
BADGE_OK    = HexColor("#43a047")
BADGE_ERR   = HexColor("#e53935")
WHITE       = white

TEMPLATE_ITEMS = {
    3:[0], 4:[1,2], 5:[3], 6:[4], 7:[5,6],
    8:[7,8], 9:[9,10], 10:[11,12], 11:[13,14], 12:[15],
}
DEFAULT_BADGE_Y = {
    3:[593], 4:[777,356], 5:[777], 6:[777], 7:[777,461],
    8:[777,386], 9:[777,594], 10:[777,499], 11:[777,455], 12:[777],
}


def _detect_badge_y(template_path):
    if not HAS_PDFMINER:
        return DEFAULT_BADGE_Y
    out = {}
    try:
        import warnings; warnings.filterwarnings("ignore")
        for pi, layout in enumerate(extract_pages(template_path)):
            if pi < 3 or pi > 12: continue
            H, ys = float(layout.height), []
            for el in layout:
                if isinstance(el, LTTextBox) and re.match(r'^Item \d+', el.get_text().strip()):
                    ys.append(round(min(el.y1 + 14, H - 25)))
            out[pi] = sorted(ys, reverse=True) if ys else DEFAULT_BADGE_Y.get(pi,[777])
    except Exception:
        return DEFAULT_BADGE_Y
    return out


def _fresh_page(path, idx):
    r = PdfReader(path)
    w = PdfWriter(); w.add_page(r.pages[idx])
    b = io.BytesIO(); w.write(b); b.seek(0)
    return PdfReader(b).pages[0]


def _score_overlay(W, H, mark, items):
    buf = io.BytesIO()
    c   = rl_canvas.Canvas(buf, pagesize=(W, H))
    PAD = 14*mm
    cx, cw, cy, ch = PAD, W-2*PAD, 78, 52*mm
    c.setFillColor(WHITE); c.setStrokeColor(CARD_STROKE); c.setLineWidth(0.6)
    c.roundRect(cx, cy, cw, ch, 4*mm, fill=1, stroke=1)
    c.setFillColor(TEXT_DARK); c.setFont("Helvetica-Bold", 9)
    c.drawString(cx+6*mm, cy+ch-9*mm, "Score Summary")
    c.setStrokeColor(CARD_STROKE); c.setLineWidth(0.4)
    c.line(cx+4*mm, cy+ch-11.5*mm, cx+cw-4*mm, cy+ch-11.5*mm)
    pct = mark/16*100
    c.setFillColor(SCORE_BLUE); c.setFont("Helvetica-Bold", 26)
    c.drawString(cx+7*mm, cy+28*mm, f"{mark} / 16")
    c.setFont("Helvetica", 11)
    c.drawString(cx+50*mm, cy+30*mm, f"({pct:.2f}%)")
    cn = sum(items)
    c.setFont("Helvetica", 8); c.setFillColor(TEXT_MID)
    c.drawString(cx+50*mm, cy+24*mm, f"Correct: {cn}   |   Incorrect / Not attempted: {16-cn}")
    c.setFont("Helvetica", 7.5); c.setFillColor(HexColor("#999999"))
    c.drawString(cx+7*mm, cy+22*mm, "Total items: 16")
    gx, gy = cx+6*mm, cy+3*mm
    cell_w, cell_h = (cw-12*mm)/16, 15*mm
    for i, s in enumerate(items):
        col = BADGE_OK if s else BADGE_ERR
        bx  = gx+i*cell_w
        c.setFillColor(col); c.roundRect(bx, gy, cell_w-1.2, cell_h, 1.5*mm, fill=1, stroke=0)
        c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 6)
        c.drawCentredString(bx+cell_w/2-0.6, gy+10*mm, f"Q{i+1}")
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(bx+cell_w/2-0.6, gy+2.5*mm, "✓" if s else "✗")
    c.save(); buf.seek(0); return buf.read()


def _badge_overlay(W, H, item_indices, item_scores, y_positions):
    buf = io.BytesIO()
    c   = rl_canvas.Canvas(buf, pagesize=(W, H))
    bx, r = W-23*mm, 9*mm
    for i, idx in enumerate(item_indices):
        if i >= len(y_positions): break
        by = y_positions[i]; score = item_scores[idx]
        c.setFillColor(BADGE_OK if score else BADGE_ERR)
        c.circle(bx, by, r, fill=1, stroke=0)
        c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 6.5)
        c.drawCentredString(bx, by+4.5*mm, f"Q{idx+1}")
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(bx, by-2.5*mm, "✓" if score else "✗")
    c.save(); buf.seek(0); return buf.read()


def _parse_zip(zip_bytes):
    """Extract student data into local dict — lives only during this call."""
    FOLDER = re.compile(r'Submissions/\[(\d+)_\d+\] - (.+?)/')
    students = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for entry in zf.namelist():
            m = FOLDER.match(entry)
            if not m: continue
            pnum, sname = m.group(1), m.group(2).strip()
            if pnum not in students:
                students[pnum] = {"name": sname, "student_number": "—",
                                   "institution": "—", "cover_bytes": None,
                                   "not_submitted": False}
            if "Cover sheet.pdf" in entry:
                data = zf.read(entry)
                students[pnum]["cover_bytes"] = data
                try:
                    r = PdfReader(io.BytesIO(data))
                    txt = "".join(p.extract_text() or "" for p in r.pages)
                    lines = [l.strip() for l in txt.splitlines() if l.strip()]
                    for i, line in enumerate(lines):
                        for key, tag in [("student_number","Student Number:"),
                                          ("institution","Institution:")]:
                            if tag in line:
                                val = line.split(tag,1)[1].strip()
                                if not val and i+1 < len(lines): val = lines[i+1]
                                if val.lower() not in ("(not set)","not set",""):
                                    students[pnum][key] = val.strip()
                except Exception: pass
            elif "Not submitted.txt" in entry:
                students[pnum]["not_submitted"] = True
    return students


def _build_pdf(cover_bytes, tpl_path, mark, items, badge_y):
    w = PdfWriter()
    cover = PdfReader(io.BytesIO(cover_bytes)).pages[0]
    CW, CH = float(cover.mediabox.width), float(cover.mediabox.height)
    ov = _score_overlay(CW, CH, mark, items)
    cover.merge_page(PdfReader(io.BytesIO(ov)).pages[0])
    w.add_page(cover)
    for pi in range(0, 3):
        w.add_page(_fresh_page(tpl_path, pi))
    tr = PdfReader(tpl_path)
    TW, TH = float(tr.pages[0].mediabox.width), float(tr.pages[0].mediabox.height)
    for tp_idx in range(3, 13):
        if tp_idx not in TEMPLATE_ITEMS: continue
        idxs = TEMPLATE_ITEMS[tp_idx]
        tp   = _fresh_page(tpl_path, tp_idx)
        ov_b = _badge_overlay(TW, TH, idxs, items, badge_y.get(tp_idx,[777]))
        tp.merge_page(PdfReader(io.BytesIO(ov_b)).pages[0])
        w.add_page(tp)
    out = io.BytesIO(); w.write(out); out.seek(0)
    return out.read()


def _make_filename(pnum, name, student_number, naming, prefix):
    safe = re.sub(r'[<>:"/\\|?*\s]', '_', name)
    if naming == "student_number":
        stem = f"{student_number.replace('/','_')}_{safe}"
    elif naming == "participant":
        stem = f"{int(pnum):03}_{safe}"
    else:
        stem = safe
    return f"{prefix}{stem}.pdf"


def generate_all_pdfs(zip_bytes, template_bytes, scores, naming, prefix,
                       progress_cb=None, error_cb=None):
    """
    All student data lives in local variables only.
    Returns: {"pdfs": {filename: bytes}, "summary": {"total":n,"ok":n,"errors":n}}
    Summary intentionally contains NO student-identifying information.
    """
    # Write template to a guaranteed-delete temp file
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tpl_path = tmp.name
    try:
        tmp.write(template_bytes); tmp.flush(); tmp.close()

        students  = _parse_zip(zip_bytes)
        badge_y   = _detect_badge_y(tpl_path)
        scores_map = {str(s.get("pnum","")).strip(): (int(s.get("mark",0)), s.get("items",[0]*16))
                      for s in scores}

        to_do  = [(p, st) for p, st in sorted(students.items(), key=lambda x: int(x[0]))
                  if not st["not_submitted"] and p in scores_map]

        pdfs = {}; ok = err = 0

        for i, (pnum, st) in enumerate(to_do):
            mark, items = scores_map[pnum]
            # Pass name to callback — caller (main.py) intentionally ignores it
            if progress_cb: progress_cb(i, len(to_do), st["name"])
            try:
                fname = _make_filename(pnum, st["name"], st["student_number"], naming, prefix)
                pdfs[fname] = _build_pdf(st["cover_bytes"], tpl_path, mark, items, badge_y)
                ok += 1
            except Exception as e:
                if error_cb: error_cb(st["name"], e)
                err += 1

        if progress_cb: progress_cb(len(to_do), len(to_do), "")

        # Return count summary only — no student data
        return {"pdfs": pdfs, "summary": {"total": len(to_do), "ok": ok, "errors": err}}

    finally:
        # Guaranteed deletion even if generation raises
        try: os.unlink(tpl_path)
        except OSError: pass
        # Help GC
        del zip_bytes, template_bytes
