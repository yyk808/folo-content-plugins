import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { describe, expect, it, vi } from "vitest"

import {
  acquire,
  articleTransform,
  extract,
  linkresearcherApiUrlFromPageUrl,
  linkresearcherHtmlFromApiPayload,
  preExtract,
} from "./linkresearcher.mjs"

const parser = unified().use(rehypeParse, { fragment: true })
const serializer = unified().use(rehypeStringify)

const fixture = `
  <html>
    <head><title>领研文章标题 | 新闻频道 | 领研网</title></head>
    <body>
      <div class="article-card">
        <span class="user-html">
          <section><blockquote><font style="color: gray">文章导语。</font></blockquote></section>
          <p><strong><font style="color: blue">专题标题</font></strong></p>
          <p><font>正文段落，包含<a href="http://example.com/source" target="_blank">参考来源</a>。</font></p>
          <p><img src="http://cdn.example.com/image.png"></p>
          <nav><a href="/share">分享</a></nav>
          <script>alert("unsafe")</script>
        </span>
        <div class="text-minor user-html">推荐内容不应被选中</div>
      </div>
    </body>
  </html>
`

describe("领研网 adapter", () => {
  const articleUrl = "https://www.linkresearcher.com/theses/bae756f2-677b-4c5d-af05-b2fa0894a300"

  it("builds the credential-free same-origin API URL", () => {
    expect(linkresearcherApiUrlFromPageUrl(articleUrl)).toBe(
      "https://www.linkresearcher.com/api/theses/bae756f2-677b-4c5d-af05-b2fa0894a300",
    )
    expect(linkresearcherApiUrlFromPageUrl("https://example.com/theses/123")).toBeNull()
    expect(
      linkresearcherApiUrlFromPageUrl("https://www.linkresearcher.com/information/123"),
    ).toBeNull()
  })

  it("uses wholeHtmlContent from the public API and falls back to upstream RSS content", async () => {
    const apiPayload = {
      title: "领研 API 标题",
      content: "<p>较短 content，不应覆盖完整正文。</p>",
      wholeHtmlContent:
        '<p onclick="unsafe()" style="color: red">完整正文来自 wholeHtmlContent。</p><script>alert("unsafe")</script><form><input value="unsafe"></form>',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(apiPayload)))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response('<html><body><div id="root"></div></body></html>'))

    const acquired = await acquire({
      context: { fetch: fetchMock, url: articleUrl },
    })
    expect(acquired).toContain("完整正文来自 wholeHtmlContent")
    expect(acquired).not.toContain("较短 content")
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://www.linkresearcher.com/api/theses/bae756f2-677b-4c5d-af05-b2fa0894a300",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    )

    const tree = parser.parse(acquired)
    preExtract({ tree, context: { url: articleUrl } })
    const article = extract({ tree })
    expect(article?.title).toBe("领研 API 标题")
    articleTransform({ tree: article.contentTree })
    const cleaned = serializer.stringify(article.contentTree)
    expect(cleaned).toContain("完整正文来自 wholeHtmlContent")
    expect(cleaned).not.toContain("unsafe")
    expect(cleaned).not.toContain("style=")

    await expect(
      acquire({
        context: { fetch: fetchMock, url: articleUrl },
        html: "<p>RSS fallback</p>",
      }),
    ).resolves.toBe("<p>RSS fallback</p>")
  })

  it("wraps API content with a safe title and retains content for the HAST cleaner", () => {
    const html = linkresearcherHtmlFromApiPayload({
      title: "标题 <危险>",
      wholeHtmlContent: '<p>正文</p><script>alert("unsafe")</script>',
    })
    expect(html).toContain("<title>标题 &lt;危险&gt;</title>")
    expect(html).toContain('<div class="user-html">')
  })

  it("keeps the complete user-html body and removes page chrome", () => {
    const tree = parser.parse(fixture)
    preExtract({
      tree,
      context: { url: articleUrl },
    })
    const article = extract({ tree })
    expect(article?.title).toBe("领研文章标题")

    articleTransform({ tree: article.contentTree })
    const html = serializer.stringify(article.contentTree)
    expect(html).toContain("文章导语")
    expect(html).toContain("专题标题")
    expect(html).toContain("正文段落")
    expect(html).toContain("https://example.com/source")
    expect(html).toContain("https://cdn.example.com/image.png")
    expect(html).toContain('data-folo-content-processor="linkresearcher-enhanced"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).not.toContain("分享")
    expect(html).not.toContain("unsafe")
    expect(html).not.toContain("推荐内容")
    expect(html).not.toContain("style=")
  })
})
