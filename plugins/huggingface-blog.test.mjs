import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { describe, expect, it, vi } from "vitest"

import { acquire, articleTransform, extract, preExtract } from "./huggingface-blog.mjs"

const parser = unified().use(rehypeParse, { fragment: true })
const serializer = unified().use(rehypeStringify)

const fixture = `
  <main>
    <div class="blog-content prose">
      <div class="mb-4"><a href="/blog">Back to Articles</a></div>
      <h1>Complete Hugging Face article</h1>
      <div class="not-prose"><button>Follow</button><p>Author controls</p></div>
      <div class="relative overflow-clip">
        <nav class="not-prose"><a href="#section">Table of contents</a></nav>
        <p>Complete article introduction.</p>
        <h2 id="section">Details</h2>
        <p>Technical body with enough useful content.</p>
        <img src="https://huggingface.co/image.png">
        <a href="https://example.com/reference">Reference</a>
        <iframe src="https://www.youtube.com/embed/example"></iframe>
        <script>window.unsafe = true</script>
        <style>.unsafe { display: none }</style>
      </div>
    </div>
  </main>
`

describe("Hugging Face Blog adapter", () => {
  it("fetches the public article and falls back to upstream RSS content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(fixture))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))

    await expect(
      acquire({ context: { fetch: fetchMock, url: "https://huggingface.co/blog/example" } }),
    ).resolves.toContain("Complete article introduction")
    await expect(
      acquire({
        context: { fetch: fetchMock, url: "https://huggingface.co/blog/example" },
        html: "<p>RSS fallback</p>",
      }),
    ).resolves.toBe("<p>RSS fallback</p>")
  })

  it("keeps the article body without the surrounding application chrome", () => {
    const tree = parser.parse(fixture)
    preExtract({ tree })
    const article = extract({ tree })
    expect(article?.title).toBe("Complete Hugging Face article")

    articleTransform({ tree: article.contentTree })
    const html = serializer.stringify(article.contentTree)
    expect(html).toContain("Complete article introduction")
    expect(html).toContain("Technical body with enough useful content")
    expect(html).toContain('data-folo-content-processor="huggingface-blog-enhanced"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).not.toContain("Back to Articles")
    expect(html).not.toContain("Author controls")
    expect(html).not.toContain("Table of contents")
    expect(html).not.toContain("youtube")
    expect(html).not.toContain("window.unsafe")
    expect(html).not.toContain("<style")
  })
})
