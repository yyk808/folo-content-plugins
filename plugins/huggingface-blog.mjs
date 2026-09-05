const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

const classNames = (element) => {
  const value = element.properties.className
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
  visitElements(tree, (element) => {
    if (!result && predicate(element)) result = element
  })
  return result
}

const removeApplicationChrome = (node) => {
  if (!Array.isArray(node.children)) return
  node.children = node.children.filter((child) => {
    if (child.type !== "element") return true
    if (classNames(child).includes("not-prose")) return false
    return ![
      "button",
      "form",
      "iframe",
      "input",
      "nav",
      "script",
      "select",
      "style",
      "template",
      "textarea",
    ].includes(child.tagName)
  })
  node.children.forEach(removeApplicationChrome)
}

export async function acquire({ context, html }) {
  try {
    const response = await context.fetch(context.url, { headers: requestHeaders })
    if (!response.ok) throw new Error(`Article request failed with HTTP ${response.status}`)
    return response.text()
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

export function preExtract({ tree }) {
  const source = findElement(tree, (element) => classNames(element).includes("blog-content"))
  if (!source) return

  const title = source.children.find((child) => child.type === "element" && child.tagName === "h1")
  const body = source.children.find(
    (child) =>
      child.type === "element" &&
      classNames(child).includes("relative") &&
      classNames(child).includes("overflow-clip"),
  )
  if (!body) return

  removeApplicationChrome(body)
  tree.children = [
    {
      type: "element",
      tagName: "div",
      properties: {
        dataFoloContentProcessor: "huggingface-blog-enhanced",
        dataFoloContentSource: "huggingface-blog",
      },
      children: [...(title ? [title] : []), body],
    },
  ]
}

export function extract({ tree }) {
  const article = findElement(
    tree,
    (element) => element.properties.dataFoloContentProcessor === "huggingface-blog-enhanced",
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
      if (typeof href === "string" && /^https?:\/\//.test(href)) {
        element.properties.rel = ["noreferrer", "noopener"]
      }
    }
  })
}
