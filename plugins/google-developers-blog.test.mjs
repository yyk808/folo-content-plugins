import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { describe, expect, it, vi } from "vitest"

import { acquire, articleTransform, extract, preExtract } from "./google-developers-blog.mjs"

const parser = unified().use(rehypeParse)
const serializer = unified().use(rehypeStringify)

const googleDevelopersFixture = `
  <!doctype html>
  <html>
    <body>
      <header><nav>Global Google Developers navigation</nav></header>
      <div class="blog-detail-container">
        <section class="tags-container"><div>Cloud</div></section>
        <section class="heading-container"><h1>Building better agent workflows</h1></section>
        <section class="summary-container"><div class="published-date">AUGUST 26, 2026</div></section>
        <section class="glue-page glue-grid">
          <section class="author-container glue-grid__col"><div class="author-obj">Google Developers team</div></section>
          <section class="social-container glue-grid__col"><button>Share</button><ul><li>Facebook</li></ul></section>
        </section>
        <section class="blocks-container glue-page">
          <div class="block">
            <img class="banner-image" src="https://storage.googleapis.com/example/banner.png" alt="Banner" />
            <div class="inner-block-content rich-content">
              <p>The complete Google Developers Blog article body.</p>
              <h2>Use a structured workflow</h2>
              <p>Keep the links, examples, and explanatory details that the RSS summary omits.</p>
              <a href="https://developers.google.com/guide">Read the guide</a>
              <a href="http://developers.google.com/legacy-guide">Read the legacy guide</a>
              <img src="http://storage.googleapis.com/example/legacy.png" alt="Legacy image" />
              <script>window.unwanted = true</script>
              <style>.unwanted { display: none }</style>
              <pre><code>const result = await agent.run(input)
	return result</code></pre>
            </div>
            <div class="inner-block-content yt-video">
              <div class="glue-video__nojs"><p><a href="https://www.youtube.com/watch?v=example">Watch the talk</a></p></div>
            </div>
          </div>
        </section>
        <section class="navigation-container"><div>posted in: AI</div></section>
        <section class="related-posts-container"><h2>Related Posts</h2><p>Recommendation noise.</p></section>
      </div>
    </body>
  </html>
`

const render = (html) => {
  const tree = parser.parse(html)
  preExtract({ tree })
  const article = extract({ tree })
  expect(article).not.toBeNull()
  articleTransform({ tree: article.contentTree })
  return { article, html: serializer.stringify(article.contentTree) }
}

describe("Google Developers Blog adapter", () => {
  it("fetches the complete article and falls back to the RSS input on errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(googleDevelopersFixture))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))

    await expect(
      acquire({
        context: {
          fetch: fetchMock,
          url: "https://developers.googleblog.com/building-better-agent-workflows/",
        },
        html: "<p>RSS summary fallback</p>",
      }),
    ).resolves.toBe(googleDevelopersFixture)
    await expect(
      acquire({
        context: {
          fetch: fetchMock,
          url: "https://developers.googleblog.com/building-better-agent-workflows/",
        },
        html: "<p>RSS summary fallback</p>",
      }),
    ).resolves.toBe("<p>RSS summary fallback</p>")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("keeps rich article blocks while dropping navigation and recommendations", () => {
    const { article, html } = render(googleDevelopersFixture)

    expect(article.title).toBe("Building better agent workflows")
    expect(html).toContain("The complete Google Developers Blog article body.")
    expect(html).toContain("Use a structured workflow")
    expect(html).toContain("const result = await agent.run(input)")
    expect(html).toContain('src="https://storage.googleapis.com/example/banner.png"')
    expect(html).toContain('href="https://developers.google.com/guide"')
    expect(html).toContain('href="https://developers.google.com/legacy-guide"')
    expect(html).toContain('src="https://storage.googleapis.com/example/legacy.png"')
    expect(html).toContain('href="https://www.youtube.com/watch?v=example"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).not.toContain("Global Google Developers navigation")
    expect(html).not.toContain("posted in")
    expect(html).not.toContain("Recommendation noise")
    expect(html).not.toContain(">Share<")
    expect(html).not.toContain('href="http://')
    expect(html).not.toContain('src="http://')
    expect(html).not.toContain("window.unwanted")
    expect(html).not.toContain(".unwanted")
  })

  it("wraps an RSS summary when the article page cannot be identified", () => {
    const { article, html } = render("<p>RSS-only Developers Blog summary.</p>")

    expect(article.title).toBeNull()
    expect(html).toContain('data-folo-content-source="rss-fallback"')
    expect(html).toContain("RSS-only Developers Blog summary.")
  })
})
