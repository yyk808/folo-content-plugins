const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

const modernArxivId = /^\d{4}\.\d{4,5}(?:v\d+)?$/
const legacyArxivId = /^[a-z-]+(?:\.[a-z-]+)?\/\d{7}(?:v\d+)?$/i

const arxivIdFromUrl = (value) => {
  const match = String(value).match(
    /^https?:\/\/(?:export\.|www\.)?arxiv\.org\/(?:abs|html|pdf)\/([^?#]+)(?:[?#].*)?$/i,
  )
  if (!match) throw new Error(`Unsupported arXiv article URL: ${value}`)
  const candidate = decodeURIComponent(match[1])
    .replace(/\.pdf$/, "")
    .replace(/\/$/, "")
  if (modernArxivId.test(candidate) || legacyArxivId.test(candidate)) return candidate
  throw new Error(`Unsupported arXiv article URL: ${value}`)
}

const resolveHttpUrl = (value, baseUrl) => {
  const input = String(value).trim()
  if (/^https?:\/\//i.test(input)) return input
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return null

  const base = String(baseUrl).match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i)
  if (!base) return null
  const protocol = base[1].toLowerCase()
  const origin = `${protocol}://${base[2]}`
  if (input.startsWith("//")) return `${protocol}:${input}`
  if (input.startsWith("#")) return `${origin}${base[3] || "/"}${input}`
  if (input.startsWith("?")) return `${origin}${base[3] || "/"}${input}`

  const suffixIndex = input.search(/[?#]/)
  const relativePath = suffixIndex < 0 ? input : input.slice(0, suffixIndex)
  const suffix = suffixIndex < 0 ? "" : input.slice(suffixIndex)
  const basePath = base[3] || "/"
  const combined = relativePath.startsWith("/")
    ? relativePath
    : `${basePath.slice(0, basePath.lastIndexOf("/") + 1)}${relativePath}`
  const segments = []
  for (const segment of combined.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") segments.pop()
    else segments.push(segment)
  }
  return `${origin}/${segments.join("/")}${suffix}`
}

const fetchArxivArticle = async (fetch, paperId) => {
  const officialUrl = `https://arxiv.org/html/${paperId}`
  const response = await fetch(officialUrl, { headers: requestHeaders })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

const classNames = (element) => {
  const value = element.properties.className
  if (Array.isArray(value)) return value.map(String)
  return typeof value === "string" ? value.split(/\s+/) : []
}

const visitElements = (tree, visitor) => {
  const visit = (node, parent) => {
    if (node.type !== "element") return
    visitor(node, parent)
    node.children.forEach((child) => visit(child, node))
  }
  tree.children.forEach((child) => visit(child, tree))
}

const findElement = (tree, predicate) => {
  let result = null
  visitElements(tree, (element) => {
    if (!result && predicate(element)) result = element
  })
  return result
}

const textContent = (node) => {
  if (node.type === "text") return node.value
  if (!node.children) return ""
  return node.children.map(textContent).join("")
}

const stringProperty = (element, ...names) => {
  for (const name of names) {
    const value = element.properties[name]
    if (typeof value === "string") return value
  }
  return null
}

const findDescendant = (root, predicate) => {
  if (root.type === "element" && predicate(root)) return root
  for (const child of root.children ?? []) {
    if (child.type !== "element") continue
    const result = findDescendant(child, predicate)
    if (result) return result
  }
  return null
}

const findDescendants = (root, predicate) => {
  const results = []
  const visit = (node) => {
    if (node.type === "element" && predicate(node)) results.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return results
}

const arxivLatexSymbolMacros = new Map([
  ["E", "\\mathbb{E}"],
  ["R", "\\mathbb{R}"],
  ["fA", "\\mathcal{A}"],
  ["fF", "\\mathcal{F}"],
  ["fS", "\\mathcal{S}"],
  ["fT", "\\mathcal{T}"],
  ["mbox", "\\text"],
  ["na", "{\\left\\lvert\\mathcal{A}\\right\\rvert}"],
  ["ns", "{\\left\\lvert\\mathcal{S}\\right\\rvert}"],
])

const arxivLatexDelimitedMacros = new Map([
  ["abs", "absolute-value"],
  ["absolutevalue", "absolute-value"],
  ["norm", "norm"],
  ["qty", "quantity"],
  ["quantity", "quantity"],
])

const latexDelimiterPairs = {
  "(": ")",
  "[": "]",
  "{": "}",
}

const findBalancedLatexDelimiter = (value, start, open, close) => {
  let depth = 0
  for (let index = start; index < value.length; index++) {
    if (value[index] === "\\") {
      index++
      continue
    }
    if (value[index] === open) depth++
    if (value[index] !== close) continue
    depth--
    if (depth === 0) return index
  }
  return -1
}

const wrapLatexArgument = (kind, open, content) => {
  if (kind === "norm") return `\\left\\lVert ${content} \\right\\rVert`
  if (kind === "absolute-value") return `\\left\\lvert ${content} \\right\\rvert`

  if (open === "{") return `\\left\\{${content}\\right\\}`
  const close = latexDelimiterPairs[open]
  return `\\left${open}${content}\\right${close}`
}

/**
 * LaTeXML preserves document-level aliases in alttext. KaTeX does not know those aliases, so
 * expand the common arXiv/physics forms before handing the formula to the app renderer.
 */
export const normalizeArxivLatex = (value) => {
  let output = ""
  let index = 0

  while (index < value.length) {
    if (value[index] !== "\\") {
      output += value[index]
      index++
      continue
    }

    const controlWord = value.slice(index + 1).match(/^[a-z]+/i)
    if (!controlWord) {
      output += value.slice(index, index + 2)
      index += 2
      continue
    }

    const name = controlWord[0]
    const commandEnd = index + name.length + 1
    const symbol = arxivLatexSymbolMacros.get(name)
    if (symbol) {
      output += symbol
      index = commandEnd
      continue
    }

    const delimitedKind = arxivLatexDelimitedMacros.get(name)
    if (!delimitedKind) {
      output += value.slice(index, commandEnd)
      index = commandEnd
      continue
    }

    let argumentStart = commandEnd
    while (/\s/.test(value[argumentStart] ?? "")) argumentStart++
    const open = value[argumentStart]
    const close = latexDelimiterPairs[open]
    if (!close || (delimitedKind !== "quantity" && open !== "{")) {
      output += value.slice(index, commandEnd)
      index = commandEnd
      continue
    }

    const argumentEnd = findBalancedLatexDelimiter(value, argumentStart, open, close)
    if (argumentEnd < 0) {
      output += value.slice(index, commandEnd)
      index = commandEnd
      continue
    }

    const content = normalizeArxivLatex(value.slice(argumentStart + 1, argumentEnd))
    output += wrapLatexArgument(delimitedKind, open, content)
    index = argumentEnd + 1
  }

  return output
}

const mathLatex = (element) => {
  const annotation = findDescendant(
    element,
    (candidate) =>
      candidate.tagName === "annotation" &&
      stringProperty(candidate, "encoding") === "application/x-tex",
  )
  const latex =
    stringProperty(element, "alttext", "altText")?.trim() ||
    textContent(annotation ?? element).trim()
  return normalizeArxivLatex(latex)
}

const normalizedMathElement = (latex, display) => ({
  type: "element",
  tagName: "math",
  properties: {
    dataMathDisplay: display ? "true" : "false",
    dataMathSource: "tex",
  },
  children: [{ type: "text", value: latex }],
})

const normalizePreRenderedKatex = (tree) => {
  const normalizeChildren = (parent) => {
    parent.children = parent.children.map((child) => {
      if (child.type !== "element") return child

      const classes = classNames(child)
      const isDisplay = classes.includes("katex-display")
      const isKatex = classes.includes("katex")
      if (isDisplay || isKatex) {
        const math = findDescendant(child, (element) => element.tagName === "math")
        const latex = math ? mathLatex(math) : ""
        if (latex) return normalizedMathElement(latex, isDisplay)
      }

      normalizeChildren(child)
      return child
    })
  }
  normalizeChildren(tree)
}

const normalizeMathElements = (tree) => {
  visitElements(tree, (element) => {
    if (element.tagName !== "math") return
    const latex = mathLatex(element)
    if (!latex) return

    const display =
      stringProperty(element, "display") === "block" ||
      stringProperty(element, "dataMathDisplay", "data-math-display") === "true"
    const normalized = normalizedMathElement(latex, display)
    element.properties = normalized.properties
    element.children = normalized.children
  })
}

const normalizeEquationTables = (tree) => {
  const normalizeChildren = (parent) => {
    parent.children = parent.children.map((child) => {
      if (child.type !== "element") return child
      normalizeChildren(child)
      if (child.tagName !== "table" || !classNames(child).includes("ltx_eqn_table")) return child

      const rows = findDescendants(child, (element) => element.tagName === "tr")
      const equationRows = (rows.length > 0 ? rows : [child]).flatMap((row) => {
        const content = findDescendant(row, (element) => {
          const classes = classNames(element)
          if (classes.includes("ltx_eqn_content")) return true
          if (element.tagName !== "td" || classes.includes("ltx_eqn_eqno")) return false
          return findDescendant(element, (candidate) => candidate.tagName === "math") !== null
        })
        if (!content) return []

        const number = findDescendant(
          row,
          (element) =>
            classNames(element).includes("ltx_eqn_eqno") && textContent(element).trim().length > 0,
        )
        return [{ content, number }]
      })
      if (equationRows.length === 0) return child

      return {
        type: "element",
        tagName: "div",
        properties: {
          className: ["folo-arxiv-equation"],
          dataFoloContentRole: "equation",
        },
        children: equationRows.flatMap(({ content, number }) => [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: ["folo-arxiv-equation-content"],
              dataFoloContentRole: "equation-content",
            },
            children: content.children,
          },
          {
            type: "element",
            tagName: "span",
            properties: {
              className: ["folo-arxiv-equation-number"],
              dataFoloContentRole: "equation-number",
            },
            children: number?.children ?? [],
          },
        ]),
      }
    })
  }
  normalizeChildren(tree)
}

const normalizeLists = (tree) => {
  visitElements(tree, (element) => {
    if (element.tagName !== "li" || !classNames(element).includes("ltx_item")) return
    delete element.properties.style
    element.children = element.children.filter(
      (child) => child.type !== "element" || !classNames(child).includes("ltx_tag_item"),
    )
  })
}

const listingMathUnicode = new Map([
  ["\\R", "ℝ"],
  ["\\alpha", "α"],
  ["\\cdot", "·"],
  ["\\epsilon", "ε"],
  ["\\exists", "∃"],
  ["\\forall", "∀"],
  ["\\gamma", "γ"],
  ["\\ge", "≥"],
  ["\\in", "∈"],
  ["\\land", "∧"],
  ["\\le", "≤"],
  ["\\llangle", "⟪"],
  ["\\mathbb{N}", "ℕ"],
  ["\\mathcal{F}", "ℱ"],
  ["\\mathcal{N}", "𝒩"],
  ["\\mu", "μ"],
  ["\\nu", "ν"],
  ["\\omega", "ω"],
  ["\\partial", "∂"],
  ["\\rrangle", "⟫"],
  ["\\sum", "∑"],
  ["\\times", "×"],
  ["\\to", "→"],
  ["^m", "ᵐ"],
  ["^{-1}", "⁻¹"],
  ["_0", "₀"],
  ["_1", "₁"],
  ["_2", "₂"],
  ["_v", "ᵥ"],
])

export const normalizeArxivListingLine = (value) =>
  value.replaceAll(/@\$(.*?)\$@/g, (_, latex) => listingMathUnicode.get(latex) ?? latex)

const normalizeListings = (tree) => {
  for (const listing of findDescendants(tree, (element) =>
    classNames(element).includes("ltx_listing"),
  )) {
    listing.children = listing.children.filter(
      (child) => child.type !== "element" || !classNames(child).includes("ltx_listing_data"),
    )

    for (const line of findDescendants(listing, (element) =>
      classNames(element).includes("ltx_listingline"),
    )) {
      line.children = [{ type: "text", value: normalizeArxivListingLine(textContent(line)) }]
    }
  }
}

export async function acquire({ context, html }) {
  const paperId = arxivIdFromUrl(context.url)

  try {
    return await fetchArxivArticle(context.fetch, paperId)
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

export function preExtract({ tree, context }) {
  const paperId = arxivIdFromUrl(context.url).replace(/v\d+$/, "")
  visitElements(tree, (element) => {
    if (classNames(element).includes("ltx_document")) {
      element.tagName = "div"
      element.properties.className = [...classNames(element), "folo-arxiv-document"]
      element.properties.dataFoloContentProcessor = "arxiv-enhanced"
      element.properties.dataFoloContentSource = "arxiv-html"
    }
    for (const property of ["href", "src"]) {
      const value = element.properties[property]
      if (typeof value !== "string" || value.startsWith("#") || value.startsWith("data:")) continue
      const resolved = resolveHttpUrl(value, context.url)
      if (resolved) element.properties[property] = resolved
      else delete element.properties[property]
    }
    if (element.tagName !== "a") return
    const href = element.properties.href
    if (typeof href !== "string") return
    try {
      const targetId = arxivIdFromUrl(href).replace(/v\d+$/, "")
      const hashIndex = href.indexOf("#")
      if (targetId === paperId && hashIndex >= 0) {
        element.properties.href = href.slice(hashIndex)
      }
    } catch {
      // Non-arXiv and already-local links are intentionally left untouched.
    }
  })
}

export function extract({ tree }) {
  const article = findElement(tree, (element) => classNames(element).includes("ltx_document"))
  if (!article) return null
  const title = findElement(
    article,
    (element) => element.tagName === "h1" && classNames(element).includes("ltx_title_document"),
  )
  return {
    contentTree: article,
    title: title ? textContent(title).replace(/\s+/g, " ").trim() : null,
  }
}

export function articleTransform({ tree }) {
  normalizePreRenderedKatex(tree)
  normalizeMathElements(tree)
  normalizeEquationTables(tree)
  normalizeLists(tree)
  normalizeListings(tree)
  visitElements(tree, (element) => {
    if (element.tagName === "img") {
      element.properties.loading = "lazy"
      element.properties.decoding = "async"
    }
    if (element.tagName === "a") {
      const href = element.properties.href
      if (typeof href === "string" && /^https?:\/\//.test(href)) {
        element.properties.rel = ["noreferrer", "noopener"]
      }
    }
  })
}
