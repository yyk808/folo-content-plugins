const alphaXivOrigin = "https://www.alphaxiv.org"

const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

const modernArxivId = /^\d{4}\.\d{4,5}(?:v\d+)?$/
const legacyArxivId = /^[a-z-]+(?:\.[a-z-]+)?\/\d{7}(?:v\d+)?$/i

const text = (value) => ({ type: "text", value: String(value) })

const element = (tagName, properties = {}, children = []) => ({
  type: "element",
  tagName,
  properties,
  children: children.filter(Boolean),
})

const classNames = (node) => {
  const value = node.properties?.className
  if (Array.isArray(value)) return value.map(String)
  return typeof value === "string" ? value.split(/\s+/) : []
}

const textContent = (node) => {
  if (node.type === "text") return node.value
  if (!Array.isArray(node.children)) return ""
  return node.children.map(textContent).join("")
}

const normalizeText = (value) => String(value).replace(/\s+/g, " ").trim()

const visitElements = (tree, visitor) => {
  const visit = (node) => {
    if (node.type !== "element") return
    visitor(node)
    node.children.forEach(visit)
  }
  tree.children.forEach(visit)
}

const findElement = (tree, predicate) => {
  let result = null
  visitElements(tree, (node) => {
    if (!result && predicate(node)) result = node
  })
  return result
}

const findElements = (tree, predicate) => {
  const results = []
  visitElements(tree, (node) => {
    if (predicate(node)) results.push(node)
  })
  return results
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

const stringProperty = (elementNode, ...names) => {
  for (const name of names) {
    const value = elementNode.properties?.[name]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

const propertyMatches = (elementNode, property, expected) =>
  stringProperty(elementNode, property)?.toLowerCase() === expected.toLowerCase()

const arxivIdFromUrl = (value) => {
  const match = String(value).match(
    /^https?:\/\/(?:export\.|www\.)?arxiv\.org\/abs\/([^/?#]+(?:\/[^?#]*)?)(?:[?#].*)?$/i,
  )
  if (!match) return null

  let candidate
  try {
    candidate = decodeURIComponent(match[1]).replace(/\/$/, "")
  } catch {
    return null
  }
  if (modernArxivId.test(candidate) || legacyArxivId.test(candidate)) return candidate
  return null
}

export const arxivIdFromArticleUrl = arxivIdFromUrl

const arxivOriginFromUrl = (value) =>
  /^https?:\/\/export\.arxiv\.org\//i.test(String(value))
    ? "https://export.arxiv.org"
    : "https://arxiv.org"

const arxivAbstractUrl = (articleUrl, paperId) => `${arxivOriginFromUrl(articleUrl)}/abs/${paperId}`

const alphaXivUrlFromArticleUrl = (articleUrl) => {
  const paperId = arxivIdFromUrl(articleUrl)
  return paperId ? `${alphaXivOrigin}/abs/${paperId}` : null
}

export { alphaXivUrlFromArticleUrl }

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

const fetchText = async (fetch, url) => {
  const response = await fetch(url, { headers: requestHeaders })
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`)
  return response.text()
}

/**
 * AlphaXiv does not expose a documented public overview API. The public paper page currently
 * renders generated overviews as section#overview .markdown-content, so only that HTML shape is
 * accepted. A page containing the "Generate Overview" placeholder is deliberately not accepted.
 */
export const hasGeneratedAlphaXivOverview = (html) =>
  /<section[^>]+id=["']overview["'][^>]*>/i.test(html) &&
  /\bmarkdown-content\b/i.test(html) &&
  !/This paper has no overview yet/i.test(html)

const metadataValue = (tree, name) => {
  const node = findElement(
    tree,
    (candidate) =>
      candidate.tagName === "meta" &&
      (propertyMatches(candidate, "name", name) || propertyMatches(candidate, "property", name)),
  )
  return node ? stringProperty(node, "content") : null
}

const metadataValues = (tree, name) =>
  findElements(
    tree,
    (candidate) => candidate.tagName === "meta" && propertyMatches(candidate, "name", name),
  )
    .map((candidate) => stringProperty(candidate, "content"))
    .filter(Boolean)

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null

const stringValue = (value) => (typeof value === "string" && value.trim() ? value.trim() : null)

const jsonLdFromTree = (tree) => {
  for (const node of findElements(
    tree,
    (candidate) =>
      candidate.tagName === "script" && propertyMatches(candidate, "type", "application/ld+json"),
  )) {
    try {
      const parsed = JSON.parse(textContent(node))
      const values = Array.isArray(parsed) ? parsed : [parsed]
      const scholarlyArticle = values
        .map(asRecord)
        .find((value) => value?.["@type"] === "ScholarlyArticle")
      if (scholarlyArticle) return scholarlyArticle
    } catch {
      // Ignore unrelated or malformed JSON-LD blocks.
    }
  }
  return null
}

const authorsFromJsonLd = (metadata) => {
  if (!Array.isArray(metadata?.author)) return []
  return metadata.author
    .map(asRecord)
    .map((author) => stringValue(author?.name))
    .filter(Boolean)
}

const formatAuthor = (value) => {
  const normalized = normalizeText(value)
  const comma = normalized.indexOf(",")
  return comma > 0
    ? `${normalized.slice(comma + 1).trim()} ${normalized.slice(0, comma).trim()}`
    : normalized
}

const titleFromTree = (tree, metadata) => {
  const citationTitle = metadataValue(tree, "citation_title")
  if (citationTitle) return normalizeText(citationTitle)

  const headline = stringValue(metadata?.headline)
  if (headline) return normalizeText(headline)

  const openGraphTitle = metadataValue(tree, "og:title")
  if (openGraphTitle) return normalizeText(openGraphTitle)

  const titleElement = findElement(
    tree,
    (candidate) =>
      candidate.tagName === "h1" &&
      (classNames(candidate).includes("title") || classNames(candidate).includes("font-title")),
  )
  if (titleElement) {
    const title = normalizeText(textContent(titleElement).replace(/^Title:\s*/i, ""))
    if (title) return title
  }

  const documentTitle = findElement(tree, (candidate) => candidate.tagName === "title")
  if (documentTitle) {
    const title = normalizeText(textContent(documentTitle).replace(/^\[[^\]]+\]\s*/, ""))
    if (title) return title.replace(/\s*\|\s*alphaXiv\s*$/i, "")
  }
  return null
}

const abstractFromTree = (tree, metadata) => {
  const citationAbstract = metadataValue(tree, "citation_abstract")
  if (citationAbstract) return normalizeText(citationAbstract)

  const abstract = stringValue(metadata?.abstract)
  if (abstract) return normalizeText(abstract)

  const openGraphDescription = metadataValue(tree, "og:description")
  if (openGraphDescription) return normalizeText(openGraphDescription)

  const abstractElement = findElement(tree, (candidate) =>
    classNames(candidate).includes("abstract"),
  )
  if (!abstractElement) return null
  const result = normalizeText(textContent(abstractElement).replace(/^Abstract:\s*/i, ""))
  return result || null
}

const authorsFromTree = (tree, metadata) => {
  const jsonLdAuthors = authorsFromJsonLd(metadata)
  if (jsonLdAuthors.length) return jsonLdAuthors

  const citationAuthors = metadataValues(tree, "citation_author").map(formatAuthor)
  if (citationAuthors.length) return citationAuthors

  const authorsElement = findElement(tree, (candidate) => classNames(candidate).includes("authors"))
  if (!authorsElement) return []
  return findElements(authorsElement, (candidate) => candidate.tagName === "a")
    .map((candidate) => normalizeText(textContent(candidate)))
    .filter(Boolean)
}

const paperMetadataFromTree = (tree, paperId) => {
  const jsonLd = jsonLdFromTree(tree)
  const metadataIdentifier =
    metadataValue(tree, "citation_arxiv_id") ??
    stringValue(asRecord(jsonLd?.citation)?.identifier) ??
    paperId
  return {
    title: titleFromTree(tree, jsonLd),
    abstract: abstractFromTree(tree, jsonLd),
    authors: authorsFromTree(tree, jsonLd),
    date:
      metadataValue(tree, "citation_date") ??
      metadataValue(tree, "citation_online_date") ??
      stringValue(jsonLd?.datePublished),
    identifier: metadataIdentifier,
    canonicalUrl: stringValue(jsonLd?.url) ?? metadataValue(tree, "og:url") ?? null,
  }
}

export const readArxivMetadata = paperMetadataFromTree

const overviewBodyFromTree = (tree) => {
  const article = findElement(tree, (node) => node.tagName === "article")
  if (!article) return null
  const overview = findElement(
    article,
    (node) => node.tagName === "section" && propertyMatches(node, "id", "overview"),
  )
  return overview
    ? findDescendant(overview, (node) => classNames(node).includes("markdown-content"))
    : null
}

const cleanOverviewTree = (node, baseUrl) => {
  const blockedTags = new Set([
    "button",
    "form",
    "input",
    "nav",
    "script",
    "select",
    "style",
    "textarea",
  ])

  const cleanChildren = (parent) => {
    parent.children = (parent.children ?? []).filter(
      (child) => child.type !== "element" || !blockedTags.has(child.tagName),
    )
    for (const child of parent.children) {
      if (child.type !== "element") continue
      delete child.properties.style
      for (const property of Object.keys(child.properties)) {
        if (/^on/i.test(property)) delete child.properties[property]
      }
      for (const property of ["href", "src"]) {
        const value = child.properties[property]
        if (typeof value !== "string" || !value.trim()) continue
        const resolved = resolveHttpUrl(value, baseUrl)
        if (resolved) child.properties[property] = resolved
        else delete child.properties[property]
      }
      cleanChildren(child)
    }
  }

  cleanChildren(node)
}

const sourceLink = (href, label) => (href ? element("a", { href }, [text(label)]) : null)

const renderHeader = (metadata, paperId, alphaUrl, officialUrl, sourceLabel) => {
  const title = metadata.title ?? `arXiv paper ${paperId}`
  const identifier = metadata.identifier ?? paperId
  const date = metadata.date ? normalizeText(metadata.date) : null
  const links = [
    sourceLink(officialUrl, "View on arXiv"),
    sourceLink(alphaUrl, "Open AlphaXiv"),
  ].filter(Boolean)
  return element("header", { dataFoloContentRole: "header" }, [
    element("p", { dataFoloContentRole: "source-label" }, [text(sourceLabel)]),
    element("h1", {}, [text(title)]),
    metadata.authors.length
      ? element("p", { dataFoloContentRole: "authors" }, [text(metadata.authors.join(", "))])
      : null,
    element("p", { dataFoloContentRole: "paper-meta" }, [
      text(`arXiv:${identifier}${date ? ` · ${date}` : ""}`),
    ]),
    links.length ? element("nav", { dataFoloContentRole: "links" }, links) : null,
  ])
}

const renderMetadataFallback = (tree, metadata, paperId, alphaUrl, officialUrl) => {
  const summary =
    metadata.abstract ??
    normalizeText(
      textContent(tree)
        .replace(/This paper has no overview yet:?/i, "")
        .replace(/Generate Overview/gi, ""),
    )
  return element(
    "div",
    {
      className: ["folo-arxiv-ai-overview", "folo-arxiv-metadata-fallback"],
      dataFoloContentProcessor: "arxiv-ai-overview",
      dataFoloContentSource: "arxiv-abstract-metadata",
    },
    [
      renderHeader(metadata, paperId, alphaUrl, officialUrl, "arXiv abstract fallback"),
      summary
        ? element("section", { dataFoloContentRole: "abstract" }, [
            element("h2", {}, [text("Abstract")]),
            element("p", {}, [text(summary)]),
          ])
        : element("p", { dataFoloContentRole: "notice" }, [
            text("The source did not provide an abstract or generated overview."),
          ]),
    ],
  )
}

const renderGeneratedOverview = (overviewBody, metadata, paperId, alphaUrl, officialUrl) => {
  cleanOverviewTree(overviewBody, alphaUrl)
  return element(
    "div",
    {
      className: ["folo-arxiv-ai-overview"],
      dataFoloContentProcessor: "arxiv-ai-overview",
      dataFoloContentSource: "alphaxiv-ai-overview",
    },
    [
      renderHeader(metadata, paperId, alphaUrl, officialUrl, "AlphaXiv AI Overview"),
      metadata.abstract
        ? element("section", { dataFoloContentRole: "abstract" }, [
            element("h2", {}, [text("Abstract")]),
            element("p", {}, [text(metadata.abstract)]),
          ])
        : null,
      element("section", { dataFoloContentRole: "ai-overview" }, [
        element("h2", {}, [text("AI Overview")]),
        ...overviewBody.children,
      ]),
    ],
  )
}

export async function acquire({ context, html }) {
  const paperId = arxivIdFromUrl(context.url)
  if (!paperId) return html

  const alphaUrl = `${alphaXivOrigin}/abs/${paperId}`
  let alphaError = null
  try {
    const alphaHtml = await fetchText(context.fetch, alphaUrl)
    if (hasGeneratedAlphaXivOverview(alphaHtml)) return alphaHtml
  } catch (error) {
    alphaError = error
  }

  try {
    return await fetchText(context.fetch, arxivAbstractUrl(context.url, paperId))
  } catch (officialError) {
    if (html?.trim()) return html
    throw alphaError ?? officialError
  }
}

export function preExtract({ tree, context }) {
  const paperId = arxivIdFromUrl(context.url)
  if (!paperId) return

  const alphaUrl = `${alphaXivOrigin}/abs/${paperId}`
  const officialUrl = arxivAbstractUrl(context.url, paperId)
  const alphaOverview = overviewBodyFromTree(tree)
  const metadata = paperMetadataFromTree(tree, paperId)
  const replacement = alphaOverview
    ? renderGeneratedOverview(alphaOverview, metadata, paperId, alphaUrl, officialUrl)
    : renderMetadataFallback(tree, metadata, paperId, alphaUrl, officialUrl)

  tree.children = [replacement]
}

export function extract({ tree }) {
  const article = findElement(tree, (node) => classNames(node).includes("folo-arxiv-ai-overview"))
  if (!article) return null
  const title = findElement(article, (node) => node.tagName === "h1")
  return {
    contentTree: article,
    title: title ? normalizeText(textContent(title)) : null,
  }
}

export function articleTransform({ tree }) {
  visitElements(tree, (node) => {
    if (node.tagName === "img") {
      node.properties.loading = "lazy"
      node.properties.decoding = "async"
    }
    if (node.tagName === "a") {
      const href = node.properties.href
      if (typeof href === "string" && /^https:\/\//i.test(href)) {
        node.properties.rel = ["noreferrer", "noopener"]
      }
    }
  })
}
