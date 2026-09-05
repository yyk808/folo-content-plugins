import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { describe, expect, it, vi } from "vitest"

import { acquire, articleTransform, extract, preExtract } from "./meta-ai-blog.mjs"

const parser = unified().use(rehypeParse, { fragment: true })
const serializer = unified().use(rehypeStringify)

const fixture = `
  <div class="article-shell">
    <div class="hero"><h1 style="color:red">Meta AI article</h1><img src="https://example.com/hero.png"></div>
    <div class="article-body">
      <p>Complete introduction.</p>
      <h3>Capabilities</h3>
      <p>Useful technical detail with an <a href="https://example.com/reference" target="_blank">external reference</a>.</p>
      <div aria-roledescription="carousel"><button>Next</button><p>Hidden prompt</p></div>
      <p>More article content.</p>
      <nav><a href="/navigation">Navigation</a></nav>
      <script>alert("unsafe")</script>
    </div>
  </div>
`

describe("Meta AI Blog adapter", () => {
  it("fetches the public article and falls back to upstream RSS content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(fixture))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))

    await expect(
      acquire({ context: { fetch: fetchMock, url: "https://ai.meta.com/blog/example/" } }),
    ).resolves.toContain("Complete introduction")
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://ai.meta.com/blog/example/",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "Mozilla/5.0 (compatible; FoloReader/1.0; +https://folo.is)",
        }),
      }),
    )
    await expect(
      acquire({
        context: { fetch: fetchMock, url: "https://ai.meta.com/blog/example/" },
        html: "<p>RSS fallback</p>",
      }),
    ).resolves.toBe("<p>RSS fallback</p>")
  })

  it("keeps the article body and removes the hero and interactive chrome", () => {
    const tree = parser.parse(fixture)
    preExtract({ tree, context: { url: "https://ai.meta.com/blog/example/" } })
    const article = extract({ tree })
    expect(article?.title).toBe("Meta AI article")

    articleTransform({ tree: article.contentTree })
    const html = serializer.stringify(article.contentTree)
    expect(html).toContain("Complete introduction")
    expect(html).toContain("More article content")
    expect(html).toContain('data-folo-content-processor="meta-ai-blog-enhanced"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).not.toContain("hero.png")
    expect(html).not.toContain("Hidden prompt")
    expect(html).not.toContain("Navigation")
    expect(html).not.toContain("unsafe")
  })
})
