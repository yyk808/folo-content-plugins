const alphaXivOrigin = "https://www.alphaxiv.org"

const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

const text = (value) => ({ type: "text", value: String(value) })

const element = (tagName, properties = {}, children = []) => ({
  type: "element",
  tagName,
  properties,
  children: children.filter(Boolean),
})

const classNames = (node) => {
  const value = node.properties.className
  if (Array.isArray(value)) return value.map(String)
  return typeof value === "string" ? value.split(/\s+/) : []
}

const textContent = (node) => {
  if (node.type === "text") return node.value
  if (!Array.isArray(node.children)) return ""
  return node.children.map(textContent).join("")
}

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

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null

const stringValue = (value) => (typeof value === "string" && value.trim() ? value.trim() : null)

export const alphaXivUrlFromArticleUrl = (articleUrl) => {
  const match = String(articleUrl).match(
    /^https?:\/\/(?:(?:export|www)\.)?(?:arxiv\.org|alphaxiv\.org)\/(?:abs|html|overview|pdf)\/([^?#]+)/i,
  )
  const paperId = match?.[1]?.replace(/\.pdf$/i, "")
  if (!paperId || !/^(?=[a-z\d])[\w./-]+$/i.test(paperId)) return null
  if (paperId.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return null
  }
  return `${alphaXivOrigin}/abs/${paperId}`
}

const paperMetadataFromTree = (tree) => {
  let metadata = null
  visitElements(tree, (node) => {
    if (metadata || node.tagName !== "script" || node.properties.type !== "application/ld+json") {
      return
    }

    try {
      const value = asRecord(JSON.parse(textContent(node)))
      if (value?.["@type"] === "ScholarlyArticle") metadata = value
    } catch {
      // Ignore unrelated or malformed JSON-LD blocks.
    }
  })
  return metadata
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
  if (input.startsWith("#")) return input
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

const authorsFromMetadata = (metadata) => {
  if (!Array.isArray(metadata?.author)) return []
  return metadata.author
    .map(asRecord)
    .map((author) => stringValue(author?.name))
    .filter(Boolean)
}

const identifierFromMetadata = (metadata) => {
  const citation = asRecord(metadata?.citation)
  return stringValue(citation?.identifier)
}

const hasGeneratedOverview = (html) =>
  /<section(?=\s|>)(?=[^>]*\sid=["']overview["'])/i.test(html) &&
  /class=["'][^"']*\bmarkdown-content\b/i.test(html)

const fetchAlphaXivHtml = async (fetch, url) => {
  const response = await fetch(url, { headers: requestHeaders })
  if (!response.ok) throw new Error(`AlphaXiv request failed with HTTP ${response.status}`)
  return response.text()
}

export async function acquire({ context, html }) {
  const alphaXivUrl = alphaXivUrlFromArticleUrl(context.url)
  if (!alphaXivUrl) return html

  try {
    const alphaXivHtml = await fetchAlphaXivHtml(context.fetch, alphaXivUrl)
    if (!hasGeneratedOverview(alphaXivHtml) && html?.trim()) return html
    return alphaXivHtml
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

const wrapRssFallback = (tree) => {
  if (!tree.children.some((node) => textContent(node).trim())) return
  tree.children = [
    element(
      "div",
      {
        className: ["folo-alphaxiv-document", "folo-alphaxiv-rss-fallback"],
        dataFoloContentProcessor: "alphaxiv-hot-overview",
        dataFoloContentSource: "rss-fallback",
      },
      tree.children,
    ),
  ]
}

export function preExtract({ tree, context }) {
  const metadata = paperMetadataFromTree(tree)
  const article = findElement(tree, (node) => node.tagName === "article")
  const overviewSection =
    article &&
    findElement(article, (node) => node.tagName === "section" && node.properties.id === "overview")
  const overviewBody =
    overviewSection &&
    findElement(overviewSection, (node) => classNames(node).includes("markdown-content"))

  if (!overviewBody) {
    wrapRssFallback(tree)
    return
  }

  const pageTitle = article && findElement(article, (node) => node.tagName === "h1")
  const abstractNode =
    article &&
    findElement(article, (node) => classNames(node).includes("paper-preview-abstract-clamp"))
  const title =
    stringValue(metadata?.headline) ??
    (pageTitle ? stringValue(textContent(pageTitle).replace(/\s+/g, " ")) : null)
  const abstract =
    stringValue(metadata?.abstract) ??
    (abstractNode ? stringValue(textContent(abstractNode).replace(/\s+/g, " ")) : null)
  const authors = authorsFromMetadata(metadata)
  const identifier = identifierFromMetadata(metadata)
  const metadataUrl = stringValue(metadata?.url)
  const canonicalUrl =
    (metadataUrl && /^https?:\/\//i.test(metadataUrl) ? metadataUrl : null) ??
    alphaXivUrlFromArticleUrl(context.url)

  cleanOverviewTree(overviewBody, canonicalUrl ?? alphaXivOrigin)

  tree.children = [
    element(
      "div",
      {
        className: ["folo-alphaxiv-document"],
        dataFoloContentProcessor: "alphaxiv-hot-overview",
        dataFoloContentSource: "alphaxiv-ai-overview",
      },
      [
        element("header", { dataFoloContentRole: "header" }, [
          element("p", { dataFoloContentRole: "source-label" }, [
            text(
              identifier ? `AlphaXiv AI Overview · arXiv:${identifier}` : "AlphaXiv AI Overview",
            ),
          ]),
          title ? element("h1", {}, [text(title)]) : null,
          authors.length
            ? element("p", { dataFoloContentRole: "authors" }, [text(authors.join(", "))])
            : null,
          canonicalUrl
            ? element("p", { dataFoloContentRole: "source-link" }, [
                element("a", { href: canonicalUrl }, [text("View on AlphaXiv")]),
              ])
            : null,
        ]),
        abstract
          ? element("section", { dataFoloContentRole: "abstract" }, [
              element("h2", {}, [text("Abstract")]),
              element("p", {}, [text(abstract)]),
            ])
          : null,
        element("section", { dataFoloContentRole: "ai-overview" }, [
          element("h2", {}, [text("AI Overview")]),
          ...overviewBody.children,
        ]),
      ],
    ),
  ]
}

export function extract({ tree }) {
  const article = findElement(tree, (node) => classNames(node).includes("folo-alphaxiv-document"))
  if (!article) return null
  const title = findElement(article, (node) => node.tagName === "h1")
  return {
    contentTree: article,
    title: title ? textContent(title).replace(/\s+/g, " ").trim() : null,
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
      if (typeof href === "string" && /^https?:\/\//.test(href)) {
        node.properties.rel = ["noreferrer", "noopener"]
      }
    }
  })
}
