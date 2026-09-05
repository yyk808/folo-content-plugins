const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent": "Mozilla/5.0 (compatible; FoloReader/1.0; +https://folo.is)",
}

const blockedTags = new Set([
  "audio",
  "button",
  "form",
  "iframe",
  "input",
  "nav",
  "noscript",
  "script",
  "select",
  "source",
  "style",
  "template",
  "textarea",
  "video",
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
  tree.children.forEach(visit)
}

const findElement = (tree, predicate) => {
  let result = null
  visitElements(tree, (element) => {
    if (!result && predicate(element)) result = element
  })
  return result
}

const hasDescendant = (node, predicate) => {
  if (node.type === "element" && predicate(node)) return true
  return (node.children ?? []).some(
    (child) => child.type === "element" && hasDescendant(child, predicate),
  )
}

const elementCount = (node, tagName) => {
  let count = 0
  if (node.type === "element" && node.tagName === tagName) count++
  for (const child of node.children ?? []) {
    if (child.type === "element") count += elementCount(child, tagName)
  }
  return count
}

const ancestorsFor = (tree, predicate) => {
  const visit = (node, ancestors) => {
    if (node.type === "element" && predicate(node)) return [...ancestors, node]
    for (const child of node.children ?? []) {
      if (child.type !== "element") continue
      const result = visit(child, [...ancestors, node])
      if (result) return result
    }
    return null
  }
  return visit(tree, [tree])
}

const articleRootFromTree = (tree) => {
  const ancestors = ancestorsFor(tree, (node) => node.tagName === "h1")
  if (!ancestors) return null

  // The Meta AI page has a small hero subtree around the h1 and a larger
  // sibling subtree containing the article. Select the closest ancestor that
  // contains several paragraphs so obfuscated class names are not required.
  for (let index = ancestors.length - 2; index >= 0; index--) {
    const candidate = ancestors[index]
    if (elementCount(candidate, "p") >= 3) return candidate
  }
  return null
}

const directChildContaining = (root, target) =>
  root.children.find(
    (child) => child.type === "element" && hasDescendant(child, (node) => node === target),
  )

const propertyValue = (element, ...names) => {
  for (const name of names) {
    const value = element.properties?.[name]
    if (Array.isArray(value) && value.length) return String(value[0]).trim() || null
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

const resolveHttpUrl = (value, baseUrl) => {
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

const isCarousel = (element) =>
  propertyValue(
    element,
    "ariaRoledescription",
    "ariaRoleDescription",
    "aria-roledescription",
  )?.toLowerCase() === "carousel"

const cleanProperties = (element, baseUrl) => {
  const properties = element.properties ?? {}
  for (const property of Object.keys(properties)) {
    if (/^on/i.test(property) || ["style", "srcSet", "srcset"].includes(property)) {
      delete properties[property]
    }
  }

  for (const property of ["href", "src", "poster"]) {
    const value = properties[property]
    if (typeof value !== "string" || !value.trim()) continue
    const resolved = resolveHttpUrl(value, baseUrl)
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

const cleanArticleChildren = (children, baseUrl) => {
  const output = []
  for (const child of children ?? []) {
    if (child.type !== "element") {
      if (child.type === "text" && child.value.trim()) output.push(child)
      continue
    }

    if (blockedTags.has(child.tagName) || isCarousel(child)) continue
    child.children = cleanArticleChildren(child.children, baseUrl)
    cleanProperties(child, baseUrl)
    if (child.tagName === "div" && child.children.length === 0) continue
    output.push(child)
  }
  return output
}

const pageLooksLikeArticle = (html) =>
  /<h1(?:\s|>)/i.test(html) && (html.match(/<p(?:\s|>)/gi)?.length ?? 0) >= 3

export async function acquire({ context, html }) {
  try {
    const response = await context.fetch(context.url, { headers: requestHeaders })
    if (!response.ok) throw new Error(`Meta AI article request failed with HTTP ${response.status}`)
    const articleHtml = await response.text()
    if (!pageLooksLikeArticle(articleHtml) && html?.trim()) return html
    return articleHtml
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

export function preExtract({ tree, context }) {
  const root = articleRootFromTree(tree)
  const title = findElement(tree, (element) => element.tagName === "h1")
  if (!root || !title) return

  const hero = directChildContaining(root, title)
  const bodyChildren = root.children.filter((child) => child !== hero)
  const content = cleanArticleChildren(bodyChildren, context.url)
  if (!content.some((node) => textContent(node).trim())) return

  cleanProperties(title, context.url)
  tree.children = [
    {
      type: "element",
      tagName: "article",
      properties: {
        className: ["folo-meta-ai-document"],
        dataFoloContentProcessor: "meta-ai-blog-enhanced",
        dataFoloContentSource: "meta-ai-blog",
      },
      children: [title, ...content],
    },
  ]
}

export function extract({ tree }) {
  const article = findElement(
    tree,
    (element) => element.properties?.dataFoloContentProcessor === "meta-ai-blog-enhanced",
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
