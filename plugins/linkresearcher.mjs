const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

const apiRequestHeaders = {
  Accept: "application/json",
  "User-Agent": requestHeaders["User-Agent"],
}

const blockedTags = new Set([
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "nav",
  "object",
  "script",
  "select",
  "style",
  "template",
  "textarea",
])

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
  tree.children.forEach((child) => visit(child))
}

const findElements = (tree, predicate) => {
  const result = []
  visitElements(tree, (element) => {
    if (predicate(element)) result.push(element)
  })
  return result
}

const findElement = (tree, predicate) => findElements(tree, predicate)[0] ?? null

const propertyValue = (element, ...names) => {
  for (const name of names) {
    const value = element.properties?.[name]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

const classNames = (element) => {
  const value = element.properties?.className
  if (Array.isArray(value)) return value.map(String)
  return typeof value === "string" ? value.split(/\s+/) : []
}

const resolveHttpsUrl = (value, baseUrl) => {
  const input = String(value).trim()
  if (/^https?:\/\//i.test(input)) return input.replace(/^http:/i, "https:")
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return null

  const base = String(baseUrl).match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i)
  if (!base) return null
  const origin = `https://${base[1]}`
  if (input.startsWith("//")) return `https:${input}`
  if (input.startsWith("#")) return `${origin}${base[2] || "/"}${input}`
  if (input.startsWith("?")) return `${origin}${base[2] || "/"}${input}`

  const suffixIndex = input.search(/[?#]/)
  const relativePath = suffixIndex < 0 ? input : input.slice(0, suffixIndex)
  const suffix = suffixIndex < 0 ? "" : input.slice(suffixIndex)
  const basePath = base[2] || "/"
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

const hasRole = (element, role) => propertyValue(element, "role")?.toLowerCase() === role

const cleanProperties = (element, baseUrl) => {
  const properties = element.properties ?? {}
  for (const property of Object.keys(properties)) {
    if (
      /^on/i.test(property) ||
      /srcdoc|xlinkhref/i.test(property) ||
      ["style", "srcSet", "srcset"].includes(property)
    ) {
      delete properties[property]
    }
  }

  for (const property of ["href", "src", "poster"]) {
    const value = properties[property]
    if (typeof value !== "string" || !value.trim()) continue
    const resolved = resolveHttpsUrl(value, baseUrl)
    if (resolved) properties[property] = resolved
    else delete properties[property]
  }

  if (element.tagName === "a") delete properties.target
  if (element.tagName === "img") {
    properties.loading = "lazy"
    properties.decoding = "async"
    if (typeof properties.alt !== "string") properties.alt = ""
  }
}

const cleanChildren = (children, baseUrl) => {
  const output = []
  for (const child of children ?? []) {
    if (child.type !== "element") {
      if (child.type === "text" && child.value.trim()) output.push(child)
      continue
    }

    if (blockedTags.has(child.tagName) || hasRole(child, "navigation")) continue
    child.children = cleanChildren(child.children, baseUrl)
    cleanProperties(child, baseUrl)

    // The source wraps almost every text node in a <font> element solely to
    // carry inline color styles. Unwrap it to keep the article readable.
    if (child.tagName === "font") {
      output.push(...child.children)
      continue
    }
    if (child.children.length === 0 && !["img", "br", "hr"].includes(child.tagName)) continue
    output.push(child)
  }
  return output
}

const titleFromTree = (tree) => {
  const title = findElement(tree, (element) => element.tagName === "title")
  if (!title) return null
  const value = textContent(title).replace(/\s+/g, " ").trim()
  return value.replace(/\s*\|\s*(?:新闻频道\s*\|\s*)?领研网\s*$/u, "").trim() || null
}

const mainUserHtml = (tree) => {
  const candidates = findElements(tree, (element) => {
    return classNames(element).includes("user-html")
  })
  return (
    candidates.sort((left, right) => textContent(right).length - textContent(left).length)[0] ??
    null
  )
}

const pageLooksLikeArticle = (html) => /class=["'][^"']*\buser-html\b/i.test(html)

const isSpaShell = (html) =>
  /<div\s[^>]*id=["']root["'][^>]*>/i.test(html) && !pageLooksLikeArticle(html)

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null

const stringValue = (value) => (typeof value === "string" && value.trim() ? value.trim() : null)

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

export const linkresearcherApiUrlFromPageUrl = (pageUrl) => {
  const match = String(pageUrl).match(
    /^https?:\/\/((?:www\.)?linkresearcher\.com)\/theses\/([0-9a-f-]+)(?:[/?#].*)?$/i,
  )
  if (!match) return null
  return `https://${match[1].toLowerCase()}/api/theses/${match[2]}`
}

const paperTitleFromPayload = (payload) => {
  const papers = Array.isArray(payload.paperList) ? payload.paperList : []
  const firstPaper = asRecord(papers[0])
  return stringValue(payload.title) ?? stringValue(firstPaper?.title)
}

export const linkresearcherHtmlFromApiPayload = (value) => {
  const payload = asRecord(value)
  if (!payload) return null
  const content = stringValue(payload.wholeHtmlContent) ?? stringValue(payload.content)
  if (!content) return null

  const title = paperTitleFromPayload(payload)
  return [
    "<!doctype html><html><head>",
    title ? `<title>${escapeHtml(title)}</title>` : "",
    '</head><body><div class="user-html">',
    content,
    "</div></body></html>",
  ].join("")
}

const fetchApiArticleHtml = async (fetch, url) => {
  const response = await fetch(url, { headers: apiRequestHeaders })
  if (!response.ok) throw new Error(`领研公开接口请求失败，HTTP ${response.status}`)

  let payload
  try {
    payload = JSON.parse(await response.text())
  } catch {
    throw new Error("领研公开接口返回了无效 JSON")
  }

  const articleHtml = linkresearcherHtmlFromApiPayload(payload)
  if (!articleHtml) throw new Error("领研公开接口没有可用正文")
  return articleHtml
}

export async function acquire({ context, html }) {
  let lastError = null
  const apiUrl = linkresearcherApiUrlFromPageUrl(context.url)

  if (apiUrl) {
    try {
      return await fetchApiArticleHtml(context.fetch, apiUrl)
    } catch (error) {
      lastError = error
    }
  }

  try {
    const response = await context.fetch(context.url, { headers: requestHeaders })
    if (!response.ok) throw new Error(`领研文章请求失败，HTTP ${response.status}`)
    const articleHtml = await response.text()
    if (pageLooksLikeArticle(articleHtml)) return articleHtml
    if (html?.trim() && !isSpaShell(articleHtml)) return html
  } catch (error) {
    lastError ??= error
  }

  if (html?.trim()) return html
  if (lastError) throw lastError
  throw new Error("领研页面没有可用正文")
}

export function preExtract({ tree, context }) {
  const source = mainUserHtml(tree)
  if (!source) return

  const content = cleanChildren(source.children, context.url)
  if (!content.some((node) => textContent(node).trim())) return
  const title = titleFromTree(tree)

  tree.children = [
    {
      type: "element",
      tagName: "article",
      properties: {
        className: ["folo-linkresearcher-document"],
        dataFoloContentProcessor: "linkresearcher-enhanced",
        dataFoloContentSource: "linkresearcher-article",
      },
      children: [
        title
          ? {
              type: "element",
              tagName: "h1",
              properties: {},
              children: [{ type: "text", value: title }],
            }
          : null,
        ...content,
      ].filter(Boolean),
    },
  ]
}

export function extract({ tree }) {
  const article = findElement(
    tree,
    (element) => element.properties?.dataFoloContentProcessor === "linkresearcher-enhanced",
  )
  if (!article) return null
  const title = findElement(article, (element) => element.tagName === "h1")
  return {
    contentTree: article,
    title: title ? textContent(title).replace(/\s+/g, " ").trim() : null,
  }
}

export function articleTransform({ tree }) {
  visitElements(tree, (element) => {
    if (element.tagName === "img") {
      element.properties.loading = "lazy"
      element.properties.decoding = "async"
    }
    if (element.tagName === "a") {
      const href = element.properties.href
      if (typeof href === "string" && /^https:\/\//i.test(href)) {
        element.properties.rel = ["noreferrer", "noopener"]
      }
    }
  })
}
