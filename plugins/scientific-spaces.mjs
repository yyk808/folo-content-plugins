const requestHeaders = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36 Folo-LocalContentProcessor/1.0",
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

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

const fetchScientificSpacesHtml = async (fetch, url) => {
  const response = await fetch(url, { headers: requestHeaders })
  if (!response.ok) throw new Error(`Article request failed with HTTP ${response.status}`)
  return response.text()
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

const readBalancedBraces = (value, start) => {
  if (value[start] !== "{") return null
  let depth = 0
  for (let index = start; index < value.length; index++) {
    if (value[index] === "\\") {
      index++
      continue
    }
    if (value[index] === "{") depth++
    if (value[index] !== "}") continue
    depth--
    if (depth === 0) return { content: value.slice(start + 1, index), end: index + 1 }
  }
  return null
}

const expandDocumentNewCommands = (html) => {
  const macros = new Map()
  let output = ""
  let cursor = 0

  while (cursor < html.length) {
    const commandStart = html.indexOf("\\newcommand", cursor)
    if (commandStart < 0) break

    let nameStart = commandStart + "\\newcommand".length
    while (/\s/.test(html[nameStart] ?? "")) nameStart++
    const name = readBalancedBraces(html, nameStart)
    const macroName = name?.content.startsWith("\\") ? name.content.slice(1) : name?.content
    if (!name || !macroName || !/^[a-z]+$/i.test(macroName)) {
      output += html.slice(cursor, nameStart)
      cursor = nameStart
      continue
    }

    let definitionStart = name.end
    while (/\s/.test(html[definitionStart] ?? "")) definitionStart++
    const definition = readBalancedBraces(html, definitionStart)
    if (!definition) {
      output += html.slice(cursor, definitionStart)
      cursor = definitionStart
      continue
    }

    macros.set(macroName, definition.content)
    output += html.slice(cursor, commandStart)
    cursor = definition.end
  }

  output += html.slice(cursor)
  for (const [name, definition] of [...macros.entries()].sort(
    ([left], [right]) => right.length - left.length,
  )) {
    output = output.replaceAll(new RegExp(`\\\\${name}(?!\\p{Letter})`, "gu"), `{${definition}}`)
  }
  return output
}

const decodeFormulaHtml = (value) =>
  value
    .replaceAll(/<br[^>]*>/gi, "\n")
    .replaceAll(/<!--(?:.|\n)*?-->/g, "")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#160;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")

const displayEnvironmentPattern =
  /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g

const displayLatex = (environment, content) => {
  const value = decodeFormulaHtml(content)
    .replaceAll(/\\label\{[^}]+\}/g, "")
    .trim()
  const base = environment.replace(/\*$/, "")
  if (base === "align") return `\\begin{aligned}${value}\\end{aligned}`
  if (base === "gather") return `\\begin{gathered}${value}\\end{gathered}`
  if (base === "multline") return `\\begin{aligned}${value}\\end{aligned}`
  return value
}

const mathElementHtml = (latex, display) =>
  `<math data-math-source="tex" data-math-display="${display ? "true" : "false"}">${escapeHtml(latex)}</math>`

/** Convert the site's MathJax document syntax into independent KaTeX-compatible math nodes. */
export const normalizeScientificSpacesMath = (sourceHtml) => {
  let html = expandDocumentNewCommands(sourceHtml)
    .replaceAll("<!--more-->", "")
    .replaceAll(/\\require\{[^}]+\}/g, "")
  const references = new Map()
  let equationNumber = 0

  for (const match of html.matchAll(displayEnvironmentPattern)) {
    const environment = match[1]
    if (environment.endsWith("*")) continue
    equationNumber++
    for (const label of match[2].matchAll(/\\label\{([^}]+)\}/g)) {
      references.set(label[1], equationNumber)
    }
  }

  html = html
    .replaceAll(/\\eqref\{([^}]+)\}/g, (value, label) =>
      references.has(label) ? `(${references.get(label)})` : value,
    )
    .replaceAll(/\\ref\{([^}]+)\}/g, (value, label) =>
      references.has(label) ? String(references.get(label)) : value,
    )

  let currentNumber = 0
  const mathNodes = []
  const preserveMath = (latex, display) => {
    const index = mathNodes.push(mathElementHtml(latex, display)) - 1
    return `\uE000folo-scientific-math-${index}\uE001`
  }

  html = html.replaceAll(displayEnvironmentPattern, (_, environment, content) => {
    const numbered = !environment.endsWith("*")
    if (numbered) currentNumber++
    let latex = displayLatex(environment, content)
    if (numbered && !/\\tag\s*\{/.test(latex)) latex += `\\tag{${currentNumber}}`
    return preserveMath(latex, true)
  })

  html = html.replaceAll(/\$\$([\s\S]*?)\$\$/g, (_, content) =>
    preserveMath(decodeFormulaHtml(content).trim(), true),
  )
  html = html.replaceAll(
    /(^|[^\\$])\$(?!\$)([\s\S]+?)(?<!\\)\$/g,
    (_, prefix, content) => `${prefix}${preserveMath(decodeFormulaHtml(content).trim(), false)}`,
  )

  for (const [index, math] of mathNodes.entries()) {
    html = html.replaceAll(`\uE000folo-scientific-math-${index}\uE001`, math)
  }
  return html
}

export async function acquire({ context, html }) {
  try {
    return await fetchScientificSpacesHtml(context.fetch, context.url)
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

export function preExtract({ tree, context }) {
  const post = findElement(tree, (element) => classNames(element).includes("Post"))
  const body = post && findElement(post, (element) => element.properties.id === "PostContent")
  if (!body) return
  const title = post && findElement(post, (element) => element.tagName === "h1")
  visitElements(body, (element) => {
    element.properties.style = undefined
    if (element.tagName === "img" && typeof element.properties.dataSrc === "string") {
      element.properties.src = element.properties.dataSrc
      delete element.properties.dataSrc
    }
    for (const property of ["href", "src"]) {
      const value = element.properties[property]
      if (typeof value !== "string" || value.startsWith("#") || value.startsWith("data:")) continue
      const resolved = resolveHttpUrl(value, context.url)
      if (resolved) element.properties[property] = resolved
      else delete element.properties[property]
    }
  })
  tree.children = [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["folo-scientific-spaces-document"],
        dataFoloContentProcessor: "scientific-spaces-enhanced",
        dataFoloContentSource: "scientific-spaces",
      },
      children: [
        ...(title ? [title] : []),
        {
          ...body,
          properties: { ...body.properties, className: ["folo-scientific-spaces-body"] },
        },
      ],
    },
  ]
}

export function extract({ tree }) {
  const article = findElement(tree, (element) =>
    classNames(element).includes("folo-scientific-spaces-document"),
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
