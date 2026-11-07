// Drawing one canvas the way the editor shows it (frontend/src/canvas/BoxNode.tsx,
// ExternalBoxNode.tsx, ConnectionEdge.tsx). draw.py works out every position
// and colour and calls these; what is here is the part only Typst can do:
// measuring text, to wrap it and cut it short with "…". Lengths are in the
// editor's pixels, as pt; the whole canvas is scaled to fit the page.

// Inter as in the editor, then fonts with Chinese, Japanese and Korean.
#let nb-fonts = ("Inter", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "PingFang SC")
#let nb-mono = ("DejaVu Sans Mono",)

// `s` on one line no wider than `width`, cut short with "…" when it is wider.
#let nb-one-line(s, width, ..style) = context {
  let shown(s) = text(..style, s)
  if measure(shown(s)).width <= width { return shown(s) }
  let parts = s.clusters()
  let (lo, hi) = (0, parts.len())
  while lo < hi {
    let mid = calc.quo(lo + hi + 1, 2)
    if measure(shown(parts.slice(0, mid).sum(default: "") + "…")).width <= width {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  shown(parts.slice(0, lo).sum(default: "").trim(at: end) + "…")
}

// `s` wrapped to `width`, centred, at most `lines` lines; the last one ends in
// "…" when there is more (CSS line-clamp). A 0.65em gap between lines matches
// the editor's line height (1.375).
#let nb-clamp(s, width, lines, ..style) = context {
  let shown(s) = block(width: width, {
    set par(leading: 0.65em)
    align(center, text(..style, s))
  })
  let tallest = measure(shown(range(lines).map(_ => "Ag").join("\n"))).height
  if measure(shown(s)).height <= tallest { return shown(s) }
  let parts = s.clusters()
  let (lo, hi) = (0, parts.len())
  while lo < hi {
    let mid = calc.quo(lo + hi + 1, 2)
    if measure(shown(parts.slice(0, mid).sum(default: "") + "…")).height <= tallest {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  shown(parts.slice(0, lo).sum(default: "").trim(at: end) + "…")
}

#let nb-icon(svg, size) = image(svg, format: "svg", width: size * 1pt, height: size * 1pt, fit: "contain")

// `body` placed with its left edge at x (or its centre, when `centered`) and
// its middle at y. Measured first, so it keeps its natural width.
#let nb-place-at(x, y, body, centered: false) = context {
  let size = measure(body)
  let left = if centered { x - size.width / 2 } else { x }
  place(dx: left, dy: y - size.height / 2, body)
}

// The canvas: its background with the editor's dot grid, everything placed on it.
#let nb-canvas(width, height, background, dot, body) = block(
  width: width * 1pt,
  height: height * 1pt,
  radius: 12pt,
  clip: true,
  fill: rgb(background),
  {
    place(rect(width: 100%, height: 100%, fill: tiling(
      size: (20pt, 20pt),
      place(dx: 9.25pt, dy: 9.25pt, circle(radius: 0.75pt, fill: rgb(dot))),
    )))
    body
  },
)

// A connection: one cubic curve, maybe a second "core" curve over it (double
// lines), and arrowheads or dots already worked out as shapes.
#let nb-line(points, stroke, core: none, ends: ()) = {
  let (s, c1, c2, t) = points.map(p => (p.at(0) * 1pt, p.at(1) * 1pt))
  let path = (curve.move(s), curve.cubic(c1, c2, t))
  place(curve(stroke: stroke, ..path))
  if core != none { place(curve(stroke: core, ..path)) }
  for end in ends {
    if end.kind == "dot" {
      let (x, y) = end.center
      place(dx: (x - end.radius) * 1pt, dy: (y - end.radius) * 1pt, circle(
        radius: end.radius * 1pt,
        fill: rgb(end.color),
      ))
    } else {
      let shape = end.points.map(p => (p.at(0) * 1pt, p.at(1) * 1pt))
      if end.kind == "arrow" {
        place(polygon(fill: rgb(end.color), ..shape))
      } else {
        place(curve(
          stroke: (paint: rgb(end.color), thickness: end.width * 1pt, join: "round"),
          curve.move(shape.at(0)),
          ..shape.slice(1).map(p => curve.line(p)),
        ))
      }
    }
  }
}

// A connection's label, centred on (x, y): its type icon (typed lines) and text.
#let nb-label(x, y, label, italic: false, icon: none, colors: (:), max-width: 192) = {
  let left = if icon == none { 8 } else { 4 }
  let text-width = max-width - 2 - left - 8 - if icon == none { 0 } else { 16 }
  let words = nb-one-line(
    label,
    text-width * 1pt,
    font: nb-fonts,
    size: 11pt,
    weight: "medium",
    style: if italic { "italic" } else { "normal" },
    fill: rgb(colors.text),
  )
  let pill = box(
    fill: rgb(colors.fill),
    stroke: 1pt + rgb(colors.border),
    radius: 6pt,
    inset: (left: left * 1pt, right: 8pt, y: 2pt),
    box(height: 16.5pt, align(horizon, if icon == none { words } else {
      grid(columns: 2, column-gutter: 4pt, align: horizon, nb-icon(icon, 12), words)
    })),
  )
  nb-place-at(x * 1pt, y * 1pt, pill, centered: true)
}

// A box on the canvas, its top-left corner at (x, y). See BoxNode.tsx.
#let nb-box(
  x,
  y,
  title,
  look: "default",
  colors: (:),
  fold: none,
  label: none,
  tech: none,
  count: none,
) = place(dx: x * 1pt, dy: y * 1pt, block(width: 240pt, height: 140pt, {
  let (w, h) = (240pt, 140pt)
  let border = if look == "group" {
    (paint: rgb(colors.border), thickness: 1pt, dash: (array: (4pt, 3pt)))
  } else { 1pt + rgb(colors.border) }
  place(rect(width: w, height: h, radius: 12pt, fill: rgb(colors.fill)))
  // A note's folded corner, top right.
  if fold != none {
    place(block(width: w, height: h, radius: 12pt, clip: true, {
      let (outer, inner) = (fold.outer * 1pt, fold.inner * 1pt)
      place(polygon(fill: rgb(colors.border), (w - outer, 0pt), (w, 0pt), (w, outer)))
      place(polygon(fill: rgb(colors.canvas), (w - inner, 0pt), (w, 0pt), (w, inner)))
    }))
  }
  place(rect(width: w, height: h, radius: 12pt, stroke: border))

  // Title, in the middle of the space below the top padding.
  place(dx: 16pt, dy: 24pt, block(width: 208pt, height: 104pt, align(center + horizon, nb-clamp(
    title,
    208pt,
    2,
    font: nb-fonts,
    size: 17pt,
    weight: "semibold",
    fill: rgb(colors.title),
  ))))

  // Technology: its logo (on a light backing if parts of it are too dark), or two letters in a tile.
  if tech != none {
    place(dx: 12pt, dy: 12pt, if tech.kind == "logo" and tech.backing != none {
      box(width: 30pt, height: 30pt, radius: 6pt, fill: rgb(tech.backing), align(center + horizon, nb-icon(tech.svg, 23)))
    } else if tech.kind == "logo" { nb-icon(tech.svg, 30) } else {
      box(width: 30pt, height: 30pt, radius: 6pt, fill: rgb(tech.fill), align(center + horizon, text(
        font: nb-fonts,
        size: 11pt,
        weight: "bold",
        tracking: 0.025em,
        fill: rgb(tech.color),
        tech.text,
      )))
    })
  }

  // How many boxes are inside, top right.
  if count != none {
    place(top + right, dx: -12pt, dy: 17pt, box(
      fill: rgb(count.fill),
      radius: 6pt,
      inset: (x: 6pt, y: 2pt),
      box(height: 16.5pt, grid(
        columns: 2,
        column-gutter: 4pt,
        align: horizon,
        nb-icon(count.icon, 12),
        text(font: nb-fonts, size: 11pt, weight: "semibold", fill: rgb(count.color), str(count.n)),
      )),
    ))
  }

  // The type label, sitting on the top border.
  if label != none {
    let words = if label.known {
      nb-one-line(
        upper(label.text),
        label.max * 1pt,
        font: nb-fonts,
        size: 10pt,
        weight: "semibold",
        tracking: 0.05em,
        fill: rgb(label.color),
      )
    } else {
      nb-one-line(label.text, label.max * 1pt, font: nb-mono, size: 10pt, weight: "semibold", fill: rgb(
        label.color,
      ))
    }
    let pill = box(
      fill: rgb(colors.canvas),
      radius: 6pt,
      stroke: if label.known { none } else {
        (paint: rgb(label.border), thickness: 1pt, dash: (array: (3pt, 2pt)))
      },
      inset: (left: 2pt, right: 6pt, y: 2pt),
      box(height: 16pt, grid(
        columns: 2,
        column-gutter: 4pt,
        align: horizon,
        box(width: 16pt, height: 16pt, radius: 4pt, fill: rgb(label.tile), align(
          center + horizon,
          nb-icon(label.icon, 12),
        )),
        words,
      )),
    )
    nb-place-at(12pt, 0pt, pill)
  }
}))

// A box from another level that a connection leads to, at the canvas edge.
// See ExternalBoxNode.tsx.
#let nb-external(x, y, title, location, colors: (:), icon: none) = place(dx: x * 1pt, dy: y * 1pt, {
  let (w, h) = (200pt, 72pt)
  place(rect(
    width: w,
    height: h,
    radius: 12pt,
    fill: rgb(colors.fill),
    stroke: (paint: rgb(colors.border), thickness: 1pt, dash: (array: (4pt, 3pt))),
  ))
  place(dx: 12pt, dy: 0pt, box(width: w - 24pt, height: h, align(horizon, grid(
    columns: (28pt, 1fr),
    column-gutter: 10pt,
    align: horizon,
    box(width: 28pt, height: 28pt, radius: 6pt, fill: rgb(colors.tile), align(center + horizon, nb-icon(
      icon,
      16,
    ))),
    stack(
      spacing: 3pt,
      nb-one-line(title, 138pt, font: nb-fonts, size: 13pt, weight: "semibold", fill: rgb(colors.title)),
      nb-one-line(location, 138pt, font: nb-fonts, size: 11pt, fill: rgb(colors.location)),
    ),
  ))))
})
