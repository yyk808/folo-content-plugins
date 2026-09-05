const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

const textContent = (node) => {
  if (node.type === "text") return node.value
  if (!Array.isArray(node.children)) return ""
  return node.children.map(textContent).join("")
}

const classNames = (node) => {
  const value = node.properties?.className
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
  visitElements(tree, (node, parent) => {
    if (!result && predicate(node, parent)) result = node
  })
  return result
}

const hasClass = (node, className) => classNames(node).includes(className)

const hasMeaningfulText = (node) => textContent(node).replace(/\s+/g, " ").trim().length > 0

const normalizeHttpsUrl = (value) => {
  if (typeof value !== "string") return null
  const url = value.trim()
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url.replace(/^http:/i, "https:")
  if (/^\/\//.test(url)) return `https:${url}`
  if (/^(?:mailto:|tel:)/i.test(url)) return url
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return null
  return url
}

const normalizeSrcSet = (value) => {
  if (typeof value !== "string") return null
  const candidates = value
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/)
      const url = normalizeHttpsUrl(parts.shift())
      return url ? [url, ...parts].join(" ") : null
    })
    .filter(Boolean)
  return candidates.length > 0 ? candidates.join(", ") : null
}

const cleanUrlProperties = (node) => {
  for (const property of ["href", "src", "poster"]) {
    const value = node.properties[property]
    const normalized = normalizeHttpsUrl(value)
    if (normalized === null) delete node.properties[property]
    else if (typeof value === "string") node.properties[property] = normalized
  }
  for (const property of ["srcSet", "srcset"]) {
    if (!(property in node.properties)) continue
    const normalized = normalizeSrcSet(node.properties[property])
    if (normalized === null) delete node.properties[property]
    else node.properties[property] = normalized
  }
}

const isArticleDocument = (html) =>
  /<div[^>]+class=["'][^"']*blog-detail-container/i.test(html) &&
  /<section[^>]+class=["'][^"']*blocks-container/i.test(html)

const removeApplicationChrome = (node) => {
  if (!Array.isArray(node.children)) return

  node.children = node.children.filter((child) => {
    if (child.type === "comment") return false
    if (child.type !== "element") return true
    const classes = classNames(child)
    if (
      [
        "button",
        "form",
        "iframe",
        "input",
        "nav",
        "audio",
        "script",
        "select",
        "style",
        "template",
        "textarea",
        "video",
        "noscript",
      ].includes(child.tagName)
    ) {
      return false
    }
    if (
      classes.some(
        (className) =>
          className === "navigation-container" ||
          className === "related-posts-container" ||
          className === "social-container" ||
          className === "tags-container" ||
          className.startsWith("share-") ||
          className.startsWith("uni-share-"),
      )
    ) {
      return false
    }
    return true
  })

  node.children.forEach((child) => {
    if (child.type !== "element") return
    for (const property of Object.keys(child.properties)) {
      if (/^on/i.test(property)) delete child.properties[property]
    }
    cleanUrlProperties(child)
    removeApplicationChrome(child)
  })
}

const wrapRssFallback = (tree) => {
  if (!tree.children.some(hasMeaningfulText)) return
  tree.children = [
    {
      type: "element",
      tagName: "article",
      properties: {
        dataFoloContentProcessor: "google-developers-blog-enhanced",
        dataFoloContentSource: "rss-fallback",
      },
      children: tree.children,
    },
  ]
}

const sectionWithClass = (container, className) =>
  (container.children ?? []).find((node) => node.type === "element" && hasClass(node, className)) ??
  null

export async function acquire({ context, html }) {
  try {
    const response = await context.fetch(context.url, { headers: requestHeaders })
    if (!response.ok) {
      throw new Error(`Google Developers Blog request failed with HTTP ${response.status}`)
    }
    const page = await response.text()
    if (!page.trim()) throw new Error("Google Developers Blog returned an empty page")
    if (!isArticleDocument(page) && html?.trim()) return html
    return page
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

export function preExtract({ tree }) {
  const container = findElement(tree, (node) => hasClass(node, "blog-detail-container"))
  if (!container) {
    wrapRssFallback(tree)
    return
  }

  const heading = sectionWithClass(container, "heading-container")
  const summary = sectionWithClass(container, "summary-container")
  const authorGrid = findElement(
    container,
    (node) => hasClass(node, "author-container") && hasClass(node, "glue-grid__col"),
  )
  const blocks = (container.children ?? []).filter(
    (node) => node.type === "element" && hasClass(node, "blocks-container"),
  )

  if (blocks.length === 0) {
    wrapRssFallback(tree)
    return
  }

  const metadata = [heading, summary, authorGrid].filter(Boolean)
  metadata.forEach(removeApplicationChrome)
  blocks.forEach(removeApplicationChrome)
  tree.children = [
    {
      type: "element",
      tagName: "article",
      properties: {
        dataFoloContentProcessor: "google-developers-blog-enhanced",
        dataFoloContentSource: "google-developers-blog",
      },
      children: [...metadata, ...blocks],
    },
  ]
}

export function extract({ tree }) {
  const article = findElement(
    tree,
    (node) => node.properties.dataFoloContentProcessor === "google-developers-blog-enhanced",
  )
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
      if (typeof href === "string" && /^https?:\/\//i.test(href)) {
        node.properties.rel = ["noreferrer", "noopener"]
      }
    }
  })
}
