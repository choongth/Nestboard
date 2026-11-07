// The report around the diagrams: page setup, headings, cover, page footer.
// document.py writes a document that calls these; canvas.typ draws the diagrams.

#import "/canvas.typ": nb-fonts

#let nb-ink = rgb("#1f2329")
#let nb-muted = rgb("#6b7280")
#let nb-rule = rgb("#e5e7eb")

// Heading sizes by level. Deeper levels look like the last one, but still nest
// in the contents and the PDF's bookmarks.
#let nb-heading-sizes = (20pt, 16pt, 14pt, 12.5pt, 11.5pt, 11pt)

// No author: the PDF does not say who exported it.
#let nb-report(title: "", date: none, paper: "a4", margin: (:), footer: "", body) = {
  set document(title: title, date: date)
  set text(font: nb-fonts, size: 10pt, fill: nb-ink, lang: "en")
  set page(
    paper: paper,
    margin: margin,
    footer: context {
      set text(size: 8pt, fill: nb-muted)
      footer
      h(1fr)
      counter(page).display()
    },
  )
  show heading: it => {
    let size = nb-heading-sizes.at(calc.min(it.level, nb-heading-sizes.len()) - 1)
    block(below: 6pt, text(size: size, weight: "semibold", it.body))
  }
  show figure.caption: it => text(size: 9pt, fill: nb-muted, it)
  show figure.where(kind: "diagram"): set block(above: 16pt)
  show outline.entry.where(level: 1): set block(above: 10pt)
  body
}

// Where a diagram sits, under its heading: "Root › Service 1".
#let nb-trail(trail) = block(above: 0pt, text(size: 9pt, fill: nb-muted, trail))

// The first page: what was exported, from where, by whom and when.
#let nb-cover(title, kicker, details) = page(footer: none, {
  v(1fr)
  text(size: 10pt, weight: "semibold", tracking: 0.12em, fill: nb-muted, upper(kicker))
  v(8pt)
  text(size: 30pt, weight: "bold", title)
  v(18pt)
  line(length: 100%, stroke: 0.75pt + nb-rule)
  v(10pt)
  grid(
    columns: (auto, 1fr),
    column-gutter: 18pt,
    row-gutter: 9pt,
    ..details.map(((name, value)) => (text(fill: nb-muted, name), value)).flatten(),
  )
  v(2fr)
  text(size: 8pt, fill: nb-muted, "Exported from Nestboard")
})
