import io
from datetime import UTC, datetime

import pytest
from pypdf import PdfReader

from app.diagram_format import normalize_document
from app.pdf_export.document import PAPERS, Cover, export_pdf, fit
from app.pdf_export.draw import Drawing
from app.pdf_export.outline import UnknownBox

COVER = Cover("Checkout platform", "Payments", datetime(2026, 11, 2, tzinfo=UTC))


def box(title, children=(), x=0, y=0):
    return {
        "id": title,
        "title": title,
        "position": {"x": x, "y": y},
        "children": list(children),
        "edges": [],
    }


def row(*boxes):
    for i, b in enumerate(boxes):
        b["position"] = {"x": i * 320, "y": 0}
    return list(boxes)


def leaves(prefix, count):
    return row(*(box(f"{prefix}.{i}") for i in range(1, count + 1)))


def services():
    return normalize_document(
        {
            "schemaVersion": 4,
            "root": box(
                "Root",
                row(
                    box(
                        "Service 1",
                        row(
                            box("Service 1.1", leaves("Service 1.1", 3)),
                            box("Service 1.2", leaves("Service 1.2", 2)),
                            box("Service 1.3"),
                        ),
                    ),
                    box("Service 2", leaves("Service 2", 2)),
                ),
            ),
        }
    )


def read(pdf):
    return PdfReader(io.BytesIO(pdf))


def text_of(page):
    """A page's text with plain spaces: Typst keeps "Diagram 3" together with a
    no-break space, and letter-spaced words come back spaced out."""
    return page.extract_text().replace("\xa0", " ")


def bookmarks(reader):
    """(depth, title, page number) for each bookmark, in order."""
    found = []

    def walk(items, depth):
        for item in items:
            if isinstance(item, list):
                walk(item, depth + 1)
            else:
                found.append((depth, item.title, reader.get_destination_page_number(item) + 1))

    walk(reader.outline, 0)
    return found


@pytest.fixture(scope="module")
def whole():
    return read(export_pdf(services(), COVER))


def test_a_cover_and_table_of_contents_come_before_one_page_per_diagram(whole):
    assert len(whole.pages) == 2 + 5
    cover = text_of(whole.pages[0])
    for text in ("Checkout platform", "02 Nov 2026"):
        assert text in cover
    assert "PAYMENTS" in cover.replace(" ", "")  # the project, upper case
    assert "The whole diagram, 5 diagrams" in cover
    contents = text_of(whole.pages[1])
    assert contents.startswith("Table of Contents")
    assert (
        contents.index("Root level") < contents.index("Service 1.2") < contents.index("Service 2")
    )


def test_the_pdf_does_not_say_who_exported_it(whole):
    assert "Exported by" not in text_of(whole.pages[0])
    assert "/Author" not in whole.metadata


def test_bookmarks_nest_like_the_boxes(whole):
    assert bookmarks(whole) == [
        (0, "Root level", 3),
        (0, "Service 1", 4),
        (1, "Service 1.1", 5),
        (1, "Service 1.2", 6),
        (0, "Service 2", 7),
    ]


def test_each_diagram_has_its_heading_the_way_there_and_a_numbered_caption(whole):
    page = text_of(whole.pages[4])
    assert page.startswith("Service 1.1")
    assert "Root › Service 1" in page
    assert "Diagram 3: Service 1.1" in page
    assert "Service 1.1.3" in page
    assert "Diagram 1: Root level" in text_of(whole.pages[2])


def test_wide_diagrams_get_a_sideways_page(whole):
    def sideways(page):
        return page.mediabox.width > page.mediabox.height

    assert not sideways(whole.pages[0])  # the cover
    assert sideways(whole.pages[4])  # three boxes in a row


def test_exporting_from_a_box_shows_only_its_inside():
    reader = read(export_pdf(services(), COVER, start="Service 1"))
    assert [(d, t) for d, t, _ in bookmarks(reader)] == [
        (0, "Service 1"),
        (0, "Service 1.1"),
        (0, "Service 1.2"),
    ]
    assert "Inside Root › Service 1, 3 diagrams" in text_of(reader.pages[0])


def test_an_empty_diagram_still_exports():
    empty = normalize_document({"schemaVersion": 4, "root": box("Root")})
    reader = read(export_pdf(empty, COVER))
    assert len(reader.pages) == 2
    contents = text_of(reader.pages[1])
    assert contents.startswith("Table of Contents")
    assert "There are no boxes to show." in contents
    assert "0 diagrams" in text_of(reader.pages[0])
    assert bookmarks(reader) == []


def test_starting_from_a_missing_box_fails():
    with pytest.raises(UnknownBox):
        export_pdf(services(), COVER, start="nope")


def test_letter_paper():
    reader = read(export_pdf(services(), COVER, paper="letter"))
    first = reader.pages[0].mediabox
    assert (round(float(first.width)), round(float(first.height))) == (612, 792)


def test_fit_turns_the_page_only_when_that_shows_the_diagram_larger():
    a4 = PAPERS["a4"]
    assert fit(Drawing(2000, 400, ""), a4)[0] is True
    assert fit(Drawing(400, 2000, ""), a4)[0] is False
    # Small enough to fit either way: upright, at the largest size allowed.
    assert fit(Drawing(300, 200, ""), a4) == (False, 0.75)
    flipped, scale = fit(Drawing(4000, 400, ""), a4)
    assert scale == pytest.approx((297 - 36) * 72 / 25.4 / 4000)
