import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acquire,
  alphaXivUrlFromArticleUrl,
  articleTransform,
  arxivIdFromArticleUrl,
  extract,
  hasGeneratedAlphaXivOverview,
  preExtract,
} from "./arxiv-ai-overview.mjs"

const parser = unified().use(rehypeParse, { fragment: true })
const serializer = unified().use(rehypeStringify)

const currentArxivAbstract =
  "Memory and RAG evaluations often treat the answering model's input as an implementation detail. We introduce RENDER, a benchmark control that fixes the conversation while varying the reader-facing artifact."

const alphaXivOverview = `
  <main>
    <script data-alphaxiv-id="json-ld-paper-detail-view" type="application/ld+json">{
      "@type": "ScholarlyArticle",
      "headline": "RENDER: Controlling Reader-Facing Evidence in LLM Memory Evaluation",
      "abstract": "${currentArxivAbstract}",
      "author": [{ "name": "Yuan Si" }, { "name": "Simeng Han" }],
      "url": "https://www.alphaxiv.org/abs/2608.23568",
      "citation": { "identifier": "2608.23568" }
    }</script>
    <nav>Application navigation</nav>
    <article>
      <h1>RENDER: Controlling Reader-Facing Evidence in LLM Memory Evaluation</h1>
      <section id="overview">
        <h2>AI Overview</h2>
        <div class="markdown-content blog-post" style="color:red">
          <h2>Why it matters</h2>
          <p>Generated explanation with a <a href="/abs/2608.23568#citation">citation</a>.</p>
          <img src="/paper.png" style="cursor:pointer" />
          <button>Open viewer</button>
          <script>alert(1)</script>
        </div>
      </section>
    </article>
  </main>
`

const alphaXivWithoutOverview = `
  <main>
    <script type="application/ld+json">{
      "@type": "ScholarlyArticle",
      "headline": "RENDER: Controlling Reader-Facing Evidence in LLM Memory Evaluation",
      "abstract": "${currentArxivAbstract}",
      "author": [{ "name": "Yuan Si" }],
      "url": "https://www.alphaxiv.org/abs/2608.23568",
      "citation": { "identifier": "2608.23568" }
    }</script>
    <article><section id="overview"><p>This paper has no overview yet.</p><button>Generate Overview</button></section></article>
  </main>
`

const arxivAbstract = `
  <html><head>
    <meta property="og:title" content="RENDER: Controlling Reader-Facing Evidence in LLM Memory Evaluation" />
    <meta property="og:description" content="${currentArxivAbstract}" />
    <meta name="citation_title" content="RENDER: Controlling Reader-Facing Evidence in LLM Memory Evaluation" />
    <meta name="citation_author" content="Si, Yuan" />
    <meta name="citation_author" content="Han, Simeng" />
    <meta name="citation_date" content="2026/06/05" />
    <meta name="citation_arxiv_id" content="2608.23568v1" />
    <meta name="citation_abstract" content="${currentArxivAbstract}" />
  </head><body><h1>Computer Science &gt; Artificial Intelligence</h1></body></html>
`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("arXiv AI Overview adapter", () => {
  it("matches arXiv and export.arxiv.org abstract URLs only", () => {
    expect(arxivIdFromArticleUrl("https://arxiv.org/abs/2608.23568v1")).toBe("2608.23568v1")
    expect(arxivIdFromArticleUrl("https://export.arxiv.org/abs/2608.23568")).toBe("2608.23568")
    expect(alphaXivUrlFromArticleUrl("https://arxiv.org/abs/2608.23568")).toBe(
      "https://www.alphaxiv.org/abs/2608.23568",
    )
    expect(arxivIdFromArticleUrl("https://example.com/abs/2608.23568")).toBeNull()
    expect(arxivIdFromArticleUrl("https://arxiv.org/pdf/2608.23568.pdf")).toBeNull()
  })

  it("accepts generated AlphaXiv HTML and rejects the placeholder page", () => {
    expect(hasGeneratedAlphaXivOverview(alphaXivOverview)).toBe(true)
    expect(hasGeneratedAlphaXivOverview(alphaXivWithoutOverview)).toBe(false)
  })

  it("renders a generated AlphaXiv overview as a clean article", async () => {
    const fetchMock = vi.fn(async () => new Response(alphaXivOverview))
    const html = await acquire({
      context: { fetch: fetchMock, url: "https://arxiv.org/abs/2608.23568" },
      html: "<p>RSS abstract</p>",
    })
    expect(html).toContain("Generated explanation")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith("https://www.alphaxiv.org/abs/2608.23568", {
      headers: expect.any(Object),
    })

    const tree = parser.parse(html)
    preExtract({ tree, context: { url: "https://arxiv.org/abs/2608.23568" } })
    const article = extract({ tree })
    articleTransform({ tree: article.contentTree })
    const result = serializer.stringify(article.contentTree)

    expect(article.title).toContain("RENDER")
    expect(result).toContain('data-folo-content-source="alphaxiv-ai-overview"')
    expect(result).toContain("AlphaXiv AI Overview")
    expect(result).toContain("Generated explanation")
    expect(result).toContain('href="https://www.alphaxiv.org/abs/2608.23568#citation"')
    expect(result).toContain('src="https://www.alphaxiv.org/paper.png"')
    expect(result).toContain('loading="lazy"')
    expect(result).not.toContain("Application navigation")
    expect(result).not.toContain("<button")
    expect(result).not.toContain("<script")
    expect(result).not.toContain("cursor:pointer")
  })

  it("falls back from an unavailable AlphaXiv overview to official arXiv metadata", async () => {
    const fetchMock = vi.fn(async (input) => {
      if (String(input).includes("alphaxiv.org")) return new Response(alphaXivWithoutOverview)
      return new Response(arxivAbstract)
    })
    const html = await acquire({
      context: { fetch: fetchMock, url: "https://export.arxiv.org/abs/2608.23568v1" },
      html: "<p>RSS abstract</p>",
    })
    expect(html).toContain("citation_abstract")
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://www.alphaxiv.org/abs/2608.23568v1",
      "https://export.arxiv.org/abs/2608.23568v1",
    ])

    const tree = parser.parse(html)
    preExtract({ tree, context: { url: "https://export.arxiv.org/abs/2608.23568v1" } })
    const article = extract({ tree })
    const result = serializer.stringify(article.contentTree)

    expect(result).toContain('data-folo-content-source="arxiv-abstract-metadata"')
    expect(result).toContain("arXiv abstract fallback")
    expect(result).toContain("Yuan Si, Simeng Han")
    expect(result).toContain("Memory and RAG evaluations")
    expect(result).toContain('href="https://export.arxiv.org/abs/2608.23568v1"')
  })

  it("keeps the RSS content if both public page requests fail", async () => {
    const rss = "<article><p>RSS abstract fallback content.</p></article>"
    const fetchMock = vi.fn(async () => new Response("Unavailable", { status: 503 }))
    await expect(
      acquire({
        context: { fetch: fetchMock, url: "https://arxiv.org/abs/2608.23568" },
        html: rss,
      }),
    ).resolves.toBe(rss)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const tree = parser.parse(rss)
    preExtract({ tree, context: { url: "https://arxiv.org/abs/2608.23568" } })
    const article = extract({ tree })
    const result = serializer.stringify(article.contentTree)
    expect(result).toContain('data-folo-content-source="arxiv-abstract-metadata"')
    expect(result).toContain("RSS abstract fallback content.")
  })
})
