import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { describe, expect, it, vi } from "vitest"

import { acquire, articleTransform, extract, preExtract } from "./google-deepmind-news.mjs"

const parser = unified().use(rehypeParse)
const serializer = unified().use(rehypeStringify)

const deepMindFixture = `
  <!doctype html>
  <html>
    <body>
      <site-nav><nav>Main navigation that must not be included</nav></site-nav>
      <main id=page-content>
        <section class="section-default section-cover section-cover--blog">
          <div class="cover__text">
            <span class="cover__text--date">August 21, 2026</span>
            <h1 class="cover__text--title">From Games to General Agents</h1>
            <div class="cover__button-group">
              <input class="share-toggle__input" type="checkbox" />
              <label class="share-toggle__button">Share</label>
            </div>
          </div>
        </section>
        <section class="grid section-default">
          <div class="rich-text">
            <p>Complete DeepMind article body.</p>
            <h2>Research details</h2>
            <p>Games provide rich environments for evaluating general agents.</p>
            <img src="/images/research.png" alt="Research image" />
            <a href="https://deepmind.google/research">Read the research</a>
            <a href="http://deepmind.google/legacy-research">Legacy research</a>
            <img src="http://storage.googleapis.com/example/legacy.png" alt="Legacy image" />
            <iframe src="https://www.youtube.com/embed/example"></iframe>
            <video src="https://cdn.example/video.mp4"></video>
            <noscript>Fallback navigation</noscript>
            <pre><code>agent.observe(screen)
agent.act("explore")</code></pre>
          </div>
        </section>
        <section class="section--has-background">
          <div class="news-group-section"><h2>Related posts</h2><p>Recommendation noise.</p></div>
        </section>
      </main>
    </body>
  </html>
`

const blogGoogleFixture = `
  <main class="site-content jump-content">
    <article class="uni-article-wrapper">
      <section class="uni-article-hero uni-article-hero--blue">
        <div class="uni-article-hero__breadcrumb">Home / Models</div>
        <h1>Gemini Flash for builders</h1>
        <div class="uni-article-hero__actions-wrapper"><button>Share</button></div>
      </section>
      <section class="uni-container article-container">
        <div class="uni-content uni-blog-article-container">
          <section class="uni-page uni-article-paragraph">
            <p>The full article body is available after the DeepMind redirect.</p>
            <img src="https://storage.googleapis.com/example/hero.png" alt="Hero" />
            <a href="https://example.com/docs">Documentation</a>
          </section>
        </div>
      </section>
      <div class="uni-blog-article-tags">Recommended topics</div>
    </article>
  </main>
`

const render = (html, contextUrl = "https://deepmind.google/blog/example/") => {
  const tree = parser.parse(html)
  preExtract({ tree, context: { url: contextUrl } })
  const article = extract({ tree })
  expect(article).not.toBeNull()
  articleTransform({ tree: article.contentTree })
  return { article, html: serializer.stringify(article.contentTree) }
}

describe("Google DeepMind News adapter", () => {
  it("fetches a complete page and keeps the RSS input when the page is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(deepMindFixture))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))

    await expect(
      acquire({
        context: { fetch: fetchMock, url: "https://deepmind.google/blog/example/" },
        html: "<p>RSS summary fallback</p>",
      }),
    ).resolves.toBe(deepMindFixture)
    await expect(
      acquire({
        context: { fetch: fetchMock, url: "https://deepmind.google/blog/example/" },
        html: "<p>RSS summary fallback</p>",
      }),
    ).resolves.toBe("<p>RSS summary fallback</p>")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("extracts the DeepMind main article without recommendations or share controls", () => {
    const { article, html } = render(deepMindFixture)

    expect(article.title).toBe("From Games to General Agents")
    expect(html).toContain("Complete DeepMind article body.")
    expect(html).toContain("agent.observe(screen)")
    expect(html).toContain('src="/images/research.png"')
    expect(html).toContain('href="https://deepmind.google/research"')
    expect(html).toContain('href="https://deepmind.google/legacy-research"')
    expect(html).toContain('src="https://storage.googleapis.com/example/legacy.png"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).not.toContain("Main navigation")
    expect(html).not.toContain("Recommendation noise")
    expect(html).not.toContain("share-toggle")
    expect(html).not.toContain("youtube.com")
    expect(html).not.toContain('href="http://')
    expect(html).not.toContain('src="http://')
    expect(html).not.toContain("Fallback navigation")
    expect(html).not.toContain(">Share<")
  })

  it("handles DeepMind articles redirected to the Google Blog layout", () => {
    const { article, html } = render(
      blogGoogleFixture,
      "https://deepmind.google/blog/introducing-gemini-3-7-flash/",
    )

    expect(article.title).toBe("Gemini Flash for builders")
    expect(html).toContain("The full article body is available after the DeepMind redirect.")
    expect(html).toContain("Documentation")
    expect(html).toContain('src="https://storage.googleapis.com/example/hero.png"')
    expect(html).not.toContain("Home / Models")
    expect(html).not.toContain("Recommended topics")
    expect(html).not.toContain("Share")
  })

  it("wraps a non-empty RSS summary as a safe fallback", () => {
    const { article, html } = render("<p>RSS-only DeepMind summary.</p>")

    expect(article.title).toBeNull()
    expect(html).toContain('data-folo-content-source="rss-fallback"')
    expect(html).toContain("RSS-only DeepMind summary.")
  })
})
