import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { describe, expect, it, vi } from "vitest"

import {
  acquire,
  alphaXivUrlFromArticleUrl,
  articleTransform,
  extract,
  preExtract,
} from "./alphaxiv-hot.mjs"

const parser = unified().use(rehypeParse, { fragment: true })
const serializer = unified().use(rehypeStringify)

const alphaXivFixture = `
  <main>
    <script type="application/ld+json">{
      "@type": "ScholarlyArticle",
      "headline": "A useful paper",
      "abstract": "The paper abstract.",
      "author": [{ "name": "Ada Lovelace" }, { "name": "Alan Turing" }],
      "url": "https://www.alphaxiv.org/abs/2608.23283",
      "citation": { "identifier": "2608.23283" }
    }</script>
    <nav>Application navigation</nav>
    <article>
      <h1>A useful paper</h1>
      <section id="overview">
        <div class="markdown-content blog-post" style="color:red">
          <h2 id="introduction">Introduction</h2>
          <p>Generated explanation with a <a href="/abs/2608.23283#citation">citation</a>.</p>
          <img class="max-w-full" src="/paper.png" style="cursor:pointer" />
          <button>Open viewer</button>
          <script>alert(1)</script>
        </div>
      </section>
    </article>
  </main>
`

describe("AlphaXiv Hot Papers adapter", () => {
  it("maps arXiv and AlphaXiv article links to the canonical AlphaXiv page", () => {
    expect(alphaXivUrlFromArticleUrl("https://arxiv.org/abs/2608.23283")).toBe(
      "https://www.alphaxiv.org/abs/2608.23283",
    )
    expect(alphaXivUrlFromArticleUrl("https://arxiv.org/pdf/2608.23283v2.pdf")).toBe(
      "https://www.alphaxiv.org/abs/2608.23283v2",
    )
    expect(alphaXivUrlFromArticleUrl("https://www.alphaxiv.org/abs/2608.spec-ptc")).toBe(
      "https://www.alphaxiv.org/abs/2608.spec-ptc",
    )
    expect(alphaXivUrlFromArticleUrl("https://example.com/paper")).toBeNull()
  })

  it("fetches the AlphaXiv page instead of the arXiv entry URL", async () => {
    const fetchMock = vi.fn(async () => new Response(alphaXivFixture))
    const result = await acquire({
      context: { fetch: fetchMock, url: "https://arxiv.org/abs/2608.23283" },
      html: "<p>RSS summary</p>",
    })

    expect(result).toContain("ScholarlyArticle")
    expect(fetchMock).toHaveBeenCalledWith("https://www.alphaxiv.org/abs/2608.23283", {
      headers: expect.any(Object),
    })
  })

  it("extracts only the AI Overview and paper metadata", () => {
    const tree = parser.parse(alphaXivFixture)
    const context = { url: "https://arxiv.org/abs/2608.23283" }
    preExtract({ tree, context })
    const article = extract({ tree })
    articleTransform({ tree: article.contentTree })
    const html = serializer.stringify(article.contentTree)

    expect(article.title).toBe("A useful paper")
    expect(html).toContain('data-folo-content-processor="alphaxiv-hot-overview"')
    expect(html).toContain('data-folo-content-source="alphaxiv-ai-overview"')
    expect(html).toContain("AlphaXiv AI Overview · arXiv:2608.23283")
    expect(html).toContain("Ada Lovelace, Alan Turing")
    expect(html).toContain("The paper abstract.")
    expect(html).toContain("Generated explanation")
    expect(html).toContain('href="https://www.alphaxiv.org/abs/2608.23283#citation"')
    expect(html).toContain('src="https://www.alphaxiv.org/paper.png"')
    expect(html).toContain('loading="lazy"')
    expect(html).not.toContain("Application navigation")
    expect(html).not.toContain("<button")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("cursor:pointer")
  })

  it("keeps the RSS summary when the overview is unavailable or the request fails", async () => {
    const rss = "<p>RSS summary</p>"
    const withoutOverview = vi.fn(async () => new Response("<article>Abstract only</article>"))
    await expect(
      acquire({
        context: { fetch: withoutOverview, url: "https://arxiv.org/abs/2608.00001" },
        html: rss,
      }),
    ).resolves.toBe(rss)

    const failedFetch = vi.fn(async () => new Response("Unavailable", { status: 503 }))
    await expect(
      acquire({
        context: { fetch: failedFetch, url: "https://arxiv.org/abs/2608.00001" },
        html: rss,
      }),
    ).resolves.toBe(rss)

    const tree = parser.parse(rss)
    preExtract({ tree, context: { url: "https://arxiv.org/abs/2608.00001" } })
    const article = extract({ tree })
    const html = serializer.stringify(article.contentTree)
    expect(html).toContain("RSS summary")
    expect(html).toContain('data-folo-content-source="rss-fallback"')
  })
})
