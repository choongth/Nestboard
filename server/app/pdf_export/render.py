"""Turns Typst code into PDF (or PNG, for looking at pages in tests)."""

from functools import cache
from pathlib import Path
from typing import Literal

import typst

HERE = Path(__file__).parent
# Inter, as in the editor (SIL Open Font License, see fonts/Inter-LICENSE.txt).
FONTS = HERE / "fonts"
# Every document starts with this: the drawing and report functions.
PRELUDE = '#import "/canvas.typ": *\n#import "/report.typ": *\n'


@cache
def _fonts() -> typst.Fonts:
    """Inter plus the system's fonts, which cover scripts Inter does not
    (Chinese, Japanese, Korean…). Looked up once: it takes a while."""
    return typst.Fonts(include_system_fonts=True, font_paths=[str(FONTS)])


def render(source: str, format: Literal["pdf", "png"] = "pdf") -> bytes | list[bytes]:
    """Compiles a document; `source` comes after PRELUDE. PNG gives one image per page."""
    compiler = typst.Compiler(root=str(HERE), font_paths=_fonts())
    result = compiler.compile((PRELUDE + source).encode("utf-8"), format=format, ppi=144.0)
    assert result is not None
    return result
