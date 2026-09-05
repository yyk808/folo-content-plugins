const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

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

const isPageDocument = (html) =>
  /<main[^>]+id=(?:["']page-content["']|page-content(?:\s|>))/i.test(html) ||
  /<article[^>]+class=(?:["'][^"']*\buni-article-wrapper\b[^"']*["']|[^\s>]*uni-article-wrapper)/i.test(
    html,
  )

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
          className.startsWith("share-") ||
          className.startsWith("uni-share-") ||
          className === "uni-article-progress-bar" ||
          className === "uni-article-hero__breadcrumb" ||
          className === "uni-article-hero__actions" ||
          className === "uni-article-hero__actions-wrapper" ||
          className === "uni-article-newsletter" ||
          className === "uni-blog-article-tags" ||
          className === "article-sidebar--desktop" ||
          className === "uni-article-jumplinks",
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
    element(
      "article",
      {
        dataFoloContentProcessor: "google-deepmind-news-enhanced",
        dataFoloContentSource: "rss-fallback",
      },
      tree.children,
    ),
  ]
}

const prepareDeepMindPage = (tree, main, context) => {
  const selected = (main.children ?? []).filter((node) => {
    if (node.type !== "element") return false
    if (node.tagName !== "section") return false
    return !findElement({ type: "root", children: [node] }, (elementNode) =>
      hasClass(elementNode, "news-group-section"),
    )
  })

  if (selected.length === 0) return false
  selected.forEach(removeApplicationChrome)
  tree.children = [
    element(
      "article",
      {
        dataFoloContentProcessor: "google-deepmind-news-enhanced",
        dataFoloContentSource: "google-deepmind",
        dataFoloContentUrl: context.url,
      },
      selected,
    ),
  ]
  return true
}

const prepareBlogGooglePage = (tree, article, context) => {
  const hero = findElement(article, (node) => hasClass(node, "uni-article-hero"))
  const body = findElement(
    article,
    (node) => hasClass(node, "uni-blog-article-container") && hasClass(node, "uni-content"),
  )
  if (!body) return false

  if (hero) removeApplicationChrome(hero)
  removeApplicationChrome(body)
  tree.children = [
    element(
      "article",
      {
        dataFoloContentProcessor: "google-deepmind-news-enhanced",
        dataFoloContentSource: "google-deepmind-blog-google",
        dataFoloContentUrl: context.url,
      },
      [hero, body],
    ),
  ]
  return true
}

export async function acquire({ context, html }) {
  try {
    const response = await context.fetch(context.url, { headers: requestHeaders })
    if (!response.ok) throw new Error(`Google DeepMind request failed with HTTP ${response.status}`)
    const page = await response.text()
    if (!page.trim()) throw new Error("Google DeepMind returned an empty page")
    if (!isPageDocument(page) && html?.trim()) return html
    return page
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

export function preExtract({ tree, context }) {
  const deepMindMain = findElement(
    tree,
    (node) => node.tagName === "main" && node.properties.id === "page-content",
  )
  if (deepMindMain && prepareDeepMindPage(tree, deepMindMain, context)) return

  const blogGoogleArticle = findElement(tree, (node) => hasClass(node, "uni-article-wrapper"))
  if (blogGoogleArticle && prepareBlogGooglePage(tree, blogGoogleArticle, context)) return

  wrapRssFallback(tree)
}

export function extract({ tree }) {
  const article = findElement(
    tree,
    (node) => node.properties.dataFoloContentProcessor === "google-deepmind-news-enhanced",
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
