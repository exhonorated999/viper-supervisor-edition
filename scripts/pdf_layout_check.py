"""
PDF layout check — proves no two pieces of text in a generated report overlap.

    uv run --with pypdf python scripts/pdf_layout_check.py

Reads every scripts/_*.pdf sample written by report-render-check.mts, pulls the
actual glyph runs and their transformation matrices out of the content streams,
builds a bounding box per run, then asserts that no two boxes on the same page
intersect.

This is the check that would have caught the bug where a stat card's 15pt value
and its 7pt label were drawn two points apart and printed on top of each other:
eyeballing one report missed it, geometry does not.
"""

import glob
import os
import sys

from pypdf import PdfReader

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Helvetica ascent/descent as a fraction of font size (AFM: 718 / -207 per 1000).
ASCENT = 0.718
DESCENT = 0.207

# Runs closer than this are treated as touching rather than overlapping — pdf
# writers routinely emit adjacent runs that share an edge pixel.
EPS = 0.6


def runs_on_page(page):
    """Every text run on the page as (text, x0, y0, x1, y1, size)."""
    found = []

    def visit(text, cm, tm, font_dict, font_size):
        if not text or not text.strip():
            return
        # Effective size = nominal size scaled by the vertical scale of the
        # text matrix and the current transformation matrix.
        scale_y = abs(tm[3]) or 1.0
        scale_x = abs(tm[0]) or 1.0
        size = abs(font_size) * scale_y * (abs(cm[3]) or 1.0)
        x = tm[4] + cm[4]
        y = tm[5] + cm[5]
        # Width: pypdf does not hand us metrics, so approximate with Helvetica's
        # average advance. Deliberately GENEROUS (0.60 em) so the check errs
        # toward reporting an overlap rather than missing one.
        width = len(text) * 0.60 * abs(font_size) * scale_x * (abs(cm[0]) or 1.0)
        found.append(
            (text.strip(), x, y - DESCENT * size, x + width, y + ASCENT * size, size)
        )

    page.extract_text(visitor_text=visit)
    return found


def overlaps(a, b):
    return (
        a[1] < b[3] - EPS
        and b[1] < a[3] - EPS
        and a[2] < b[4] - EPS
        and b[2] < a[4] - EPS
    )


def check(path):
    reader = PdfReader(path)
    problems = []
    for pno, page in enumerate(reader.pages, start=1):
        runs = runs_on_page(page)
        for i in range(len(runs)):
            for j in range(i + 1, len(runs)):
                a, b = runs[i], runs[j]
                # Same baseline = a single logical line pypdf split into runs.
                if abs(a[2] - b[2]) < 0.5 and abs(a[5] - b[5]) < 0.5:
                    continue
                if overlaps(a, b):
                    problems.append(
                        f"    page {pno}: {a[0]!r} (y~{a[2]:.1f}, {a[5]:.1f}pt) "
                        f"collides with {b[0]!r} (y~{b[2]:.1f}, {b[5]:.1f}pt)"
                    )
    return problems


def main():
    samples = sorted(glob.glob(os.path.join(REPO, "scripts", "_*.pdf")))
    if not samples:
        print("No sample PDFs found. Run: npx tsx scripts/report-render-check.mts")
        return 1

    failed = 0
    for path in samples:
        name = os.path.basename(path)
        problems = check(path)
        if problems:
            failed += 1
            print(f"  FAIL  {name}")
            for p in problems[:8]:
                print(p)
            if len(problems) > 8:
                print(f"    … {len(problems) - 8} more")
        else:
            print(f"  PASS  {name}")

    print(f"\n{len(samples) - failed}/{len(samples)} sample PDFs are collision-free")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
