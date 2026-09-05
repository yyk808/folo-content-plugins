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

const fetchText = async (fetch, url) => {
  const response = await fetch(url, { headers: requestHeaders })
  if (!response.ok) throw new Error(`Article request failed with HTTP ${response.status}`)
  return response.text()
}

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null

const stringValue = (value) => (typeof value === "string" && value.trim() ? value.trim() : null)
const numberValue = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)

const repoFromTree = (tree) => {
  const data = findElement(
    tree,
    (element) => element.tagName === "script" && element.properties.id === "__NEXT_DATA__",
  )
  if (!data) return null
  try {
    const payload = asRecord(JSON.parse(textContent(data)))
    const props = asRecord(payload?.props)
    const pageProps = asRecord(props?.pageProps)
    return asRecord(pageProps?.repo)
  } catch {
    return null
  }
}

const formatCount = (value) =>
  typeof value === "number"
    ? String(Math.trunc(value)).replace(/\B(?=(?:\d{3})+(?!\d))/g, ",")
    : "—"

const text = (value) => ({ type: "text", value: String(value) })

const element = (tagName, properties = {}, children = []) => ({
  type: "element",
  tagName,
  properties,
  children: children.filter(Boolean),
})

const className = (value) => ({ className: [value] })

const optionalLink = (href, label) =>
  href ? element("a", { ...className("folo-hg-link"), href }, [text(label)]) : null

const metadataItem = (label, value) =>
  value
    ? element("div", {}, [element("dt", {}, [text(label)]), element("dd", {}, [text(value)])])
    : null

const statisticItem = (value, label) =>
  element("li", {}, [
    element("strong", {}, [text(formatCount(value))]),
    element("span", {}, [text(label)]),
  ])

export const renderHelloGitHubProject = (repo, articleUrl) => {
  const fullName = stringValue(repo.full_name) ?? stringValue(repo.name) ?? "HelloGitHub project"
  const title = stringValue(repo.title)
  const summary = stringValue(repo.summary) ?? stringValue(repo.description) ?? ""
  const description = stringValue(repo.description)
  const sourceUrl = stringValue(repo.url)
  const imageUrl = stringValue(repo.image_url)
  const language = stringValue(repo.primary_lang)
  const license = stringValue(repo.license_spdx_id) ?? stringValue(repo.license)
  const stars = numberValue(repo.stars)
  const forks = numberValue(repo.forks)
  const issues = numberValue(repo.open_issues)
  const contributors = numberValue(repo.contributors)
  const score = stringValue(repo.score_str)
  const starHistory = asRecord(repo.star_history)
  const starIncrement = numberValue(starHistory?.increment)
  const tags = Array.isArray(repo.tags)
    ? repo.tags
        .map(asRecord)
        .map((tag) => stringValue(tag?.name))
        .filter(Boolean)
    : []
  const volume = stringValue(repo.volume_name)
  const updatedAt = stringValue(repo.updated_at)

  const links = [
    optionalLink(sourceUrl, "GitHub 源码"),
    optionalLink(stringValue(repo.homepage), "项目主页"),
    optionalLink(stringValue(repo.document), "文档"),
    optionalLink(stringValue(repo.download), "下载"),
    optionalLink(stringValue(repo.online), "在线体验"),
    optionalLink(articleUrl, "HelloGitHub 原页"),
  ].filter(Boolean)

  return element(
    "div",
    {
      ...className("folo-hellogithub-project"),
      dataFoloContentProcessor: "hellogithub-enhanced",
      dataFoloContentSource: "hellogithub-next-data",
    },
    [
      element("header", className("folo-hg-hero"), [
        element("div", className("folo-hg-identity"), [
          imageUrl
            ? element("span", className("folo-hg-cover-frame"), [
                element(
                  "img",
                  {
                    ...className("folo-hg-cover"),
                    alt: fullName,
                    height: 80,
                    src: imageUrl,
                    width: 80,
                  },
                  [],
                ),
              ])
            : null,
          element("div", className("folo-hg-heading"), [
            element("p", className("folo-hg-kicker"), [text("HelloGitHub · 开源项目")]),
            element("h1", {}, [
              sourceUrl ? element("a", { href: sourceUrl }, [text(fullName)]) : text(fullName),
            ]),
            title ? element("p", className("folo-hg-title"), [text(title)]) : null,
          ]),
        ]),
        summary ? element("p", className("folo-hg-summary"), [text(summary)]) : null,
        tags.length
          ? element(
              "ul",
              className("folo-hg-tags"),
              tags.map((tag) => element("li", {}, [text(tag)])),
            )
          : null,
      ]),
      element("section", { ariaLabel: "项目数据" }, [
        element("ul", className("folo-hg-stats"), [
          statisticItem(stars, "Stars"),
          statisticItem(forks, "Forks"),
          statisticItem(issues, "Issues"),
          statisticItem(contributors, "贡献者"),
        ]),
        starIncrement !== null
          ? element("p", className("folo-hg-trend"), [
              text("近 7 日新增 "),
              element("strong", {}, [text(`+${formatCount(starIncrement)}`)]),
              text(" Stars"),
            ])
          : null,
      ]),
      element("section", className("folo-hg-section"), [
        element("h2", {}, [text("项目介绍")]),
        summary ? element("p", {}, [text(summary)]) : null,
        description && description !== summary
          ? element("blockquote", {}, [element("p", {}, [text(description)])])
          : null,
      ]),
      element("section", className("folo-hg-section"), [
        element("h2", {}, [text("项目信息")]),
        element("dl", className("folo-hg-metadata"), [
          metadataItem("主要语言", language),
          metadataItem("开源协议", license),
          metadataItem("HelloGitHub 评分", score),
          metadataItem("收录月刊", volume ? `第 ${volume} 期` : null),
          metadataItem(
            "数据更新",
            updatedAt ? updatedAt.replace("T", " ").replace(/Z$/, " UTC") : null,
          ),
        ]),
      ]),
      links.length
        ? element("nav", { ...className("folo-hg-links"), ariaLabel: "项目链接" }, links)
        : null,
    ],
  )
}

export async function acquire({ context, html }) {
  try {
    return await fetchText(context.fetch, context.url)
  } catch (error) {
    if (html?.trim()) return html
    throw error
  }
}

export function extract({ tree, context }) {
  const repo = repoFromTree(tree)
  if (!repo) return null
  const title = stringValue(repo.title)
  const fullName = stringValue(repo.full_name) ?? stringValue(repo.name)
  return {
    contentTree: renderHelloGitHubProject(repo, context.url),
    title: title && fullName ? `${fullName}: ${title}` : (fullName ?? title),
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
