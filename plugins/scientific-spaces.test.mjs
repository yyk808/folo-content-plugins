import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { describe, expect, it, vi } from "vitest"

import {
  acquire,
  articleTransform,
  extract,
  normalizeScientificSpacesMath,
  preExtract,
} from "./scientific-spaces.mjs"

describe("scientific spaces adapter", () => {
  it("leaves scripts, code samples and existing math intact", () => {
    const protectedHtml = String.raw`<script>const $ = window.jQuery;</script><pre>\begin{equation}x\end{equation}</pre><code>$x$</code><math data-math-source="tex">\text{price: $5}</math>`
    const result = normalizeScientificSpacesMath(`${protectedHtml}<p>$H_t$</p>`)
    expect(result).toContain(protectedHtml)
    expect(result).toContain('data-math-display="false">H_t</math>')
  })

  it("does not let truncated sidebar math consume article markup or display equations", () => {
    const result = normalizeScientificSpacesMath(
      String.raw`<aside><p>评论$me_j...</p><p>另一个$$未完成...</p></aside><div class="Post"><h1>标题</h1><div id="PostContent"><p>$H_t$正定</p><p>\begin{equation}x=1\end{equation}</p><p>$$x^2$$</p></div></div>`,
    )
    expect(result).toContain("<aside><p>评论$me_j...</p><p>另一个$$未完成...</p></aside>")
    expect(result).toContain('<div class="Post"><h1>标题</h1><div id="PostContent">')
    expect(result).toContain('data-math-display="false">H_t</math>')
    expect(result.match(/data-math-display="true"/g)).toHaveLength(2)
    expect(result).not.toContain("folo-scientific-math-")
  })

  it("expands document macros and converts numbered display environments", () => {
    const result = normalizeScientificSpacesMath(String.raw`
      <p>See \eqref{eq:phi}.</p>
      <p>\begin{equation}\newcommand{msign}{\mathop{\text{msign}}}\msign(X)\label{eq:phi}\end{equation}</p>
      <p>\begin{equation}\msign(Y)\end{equation}</p>
    `)

    expect(result).toContain("See (1).")
    expect(result).toContain('data-math-display="true"')
    expect(result).toContain("{\\mathop{\\text{msign}}}(X)\\tag{1}")
    expect(result).toContain("{\\mathop{\\text{msign}}}(Y)\\tag{2}")
    expect(result).not.toContain("\\newcommand")
    expect(result).not.toContain("\\label")
  })

  it("converts align and removes HTML breaks inside formulas", () => {
    const result = normalizeScientificSpacesMath(String.raw`
      \begin{align}a &amp;= b \\<br />c &amp;= d\end{align}
    `)

    expect(result).toContain("\\begin{aligned}a &amp;= b")
    expect(result).toContain("c &amp;= d\\end{aligned}\\tag{1}")
    expect(result).not.toContain("<br")
  })

  it("drops MathJax extension loaders that KaTeX does not accept", () => {
    const result = normalizeScientificSpacesMath(
      String.raw`$\require{cancel}\cancel{x} = \cancel{y}$`,
    )

    expect(result).toContain('data-math-display="false"')
    expect(result).toContain(String.raw`\cancel{x} = \cancel{y}`)
    expect(result).not.toContain("\\require")
  })

  it("joins dollar math that the source splits with HTML breaks", () => {
    const result = normalizeScientificSpacesMath(
      String.raw`设有矩阵$\begin{bmatrix}A &amp; C \\<br />B &amp; D\end{bmatrix}$，固定 A。`,
    )

    expect(result).toContain('data-math-display="false"')
    expect(result).toContain("\\begin{bmatrix}A &amp; C")
    expect(result).toContain("B &amp; D\\end{bmatrix}")
    expect(result).not.toContain("<br")
    expect(result).not.toContain("$\\begin")
  })
})

const articleHtml = String.raw`<div class="Post"><h1>经典自适应梯度算法</h1><div id="PostContent">
  <p>这次我们考虑一般的更新规则<br />
  \begin{equation}\boldsymbol{\theta}_{t+1} = \boldsymbol{\theta}_t - \eta_t
  \boldsymbol{H}_t^{-1}\boldsymbol{g}(\boldsymbol{x}_t,\boldsymbol{\theta}_t)
  \label{eq:H-g}\end{equation}<br />
  其中$H_t$是正定对称矩阵，见\eqref{eq:H-g}。</p>
</div></div>`

describe("scientific spaces pipeline", () => {
  const processArticle = async (fetch, html) => {
    const context = { url: "https://kexue.fm/archives/11882", fetch }
    const acquired = await acquire({ context, html })
    const processor = unified().use(rehypeParse, { fragment: true }).use(rehypeStringify)
    const tree = processor.parse(acquired)
    preExtract({ tree, context })
    const article = extract({ tree })
    expect(article.title).toBe("经典自适应梯度算法")
    const contentTree = { type: "root", children: [article.contentTree] }
    articleTransform({ tree: contentTree })
    return processor.stringify(contentTree)
  }

  it("normalizes fetched display math before parsing and preserves it through extraction", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => articleHtml })
    const result = await processArticle(fetch)
    expect(fetch).toHaveBeenCalledOnce()
    expect(result).toContain('data-math-source="tex" data-math-display="true"')
    expect(result).toContain(String.raw`\boldsymbol{\theta}_{t+1}`)
    expect(result).toContain(String.raw`\tag{1}`)
    expect(result).toContain('data-math-display="false">H_t</math>')
    expect(result).toContain("见(1)。")
    expect(result).not.toContain(String.raw`\begin{equation}`)
    expect(result).not.toContain(String.raw`\label`)
  })

  it.each(["network", "http"])("normalizes fallback HTML after a %s failure", async (failure) => {
    const fetch =
      failure === "network"
        ? vi.fn().mockRejectedValue(new Error("Offline"))
        : vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const result = await processArticle(fetch, articleHtml)
    expect(result).toContain('data-math-display="true"')
    expect(result).toContain(String.raw`\tag{1}`)
    expect(result).not.toContain(String.raw`\begin{equation}`)
  })

  it("preserves a fetch failure when no fallback HTML is available", async () => {
    const error = new Error("Offline")
    await expect(
      acquire({
        context: {
          url: "https://kexue.fm/archives/11882",
          fetch: async () => {
            throw error
          },
        },
      }),
    ).rejects.toBe(error)
  })
})
