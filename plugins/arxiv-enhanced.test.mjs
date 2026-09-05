import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { unified } from "unified"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acquire,
  articleTransform,
  extract,
  normalizeArxivLatex,
  normalizeArxivListingLine,
  preExtract,
} from "./arxiv-enhanced.mjs"

const parser = unified().use(rehypeParse, { fragment: true })
const serializer = unified().use(rehypeStringify)

const arxivHtml = `
  <article class="ltx_document">
    <h1 class="ltx_title ltx_title_document">Fallback arXiv full text</h1>
    <section><h2>Paper section</h2><p>Full paper content.</p></section>
  </article>
`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("arXiv enhanced article transform", () => {
  it("expands LaTeXML document macros into KaTeX-compatible formulas", () => {
    expect(
      normalizeArxivLatex(
        "\\norm{x}_{p}\\doteq\\quantity(\\sum_i \\abs{x_i}^p)^{1/p}, \\quantity{v_t \\in\\R^\\ns}",
      ),
    ).toBe(
      "\\left\\lVert x \\right\\rVert_{p}\\doteq\\left(\\sum_i \\left\\lvert x_i \\right\\rvert^p\\right)^{1/p}, \\left\\{v_t \\in\\mathbb{R}^{\\left\\lvert\\mathcal{S}\\right\\rvert}\\right\\}",
    )

    expect(normalizeArxivLatex("\\E\\qty[G(w, Y) | \\fF_t] + \\fT_* q")).toBe(
      "\\mathbb{E}\\left[G(w, Y) | \\mathcal{F}_t\\right] + \\mathcal{T}_* q",
    )
  })

  it("normalizes math escapes embedded in arXiv code listings", () => {
    expect(
      normalizeArxivListingLine(
        "class StochasticVec (x : S @$\\to$@ @$\\R$@) where\n  nonneg : @$\\forall$@ s, 0 @$\\le$@ x s",
      ),
    ).toBe("class StochasticVec (x : S → ℝ) where\n  nonneg : ∀ s, 0 ≤ x s")

    const tree = parser.parse(`
      <article class="ltx_document">
        <div class="ltx_listing ltx_lstlisting">
          <div class="ltx_listing_data"><a href="data:text/plain">⬇</a></div>
          <div class="ltx_listingline"><span>n : @$</span>\\<span>mathbb{N}$@</span></div>
        </div>
      </article>
    `)

    articleTransform({ tree })
    const result = serializer.stringify(tree)

    expect(result).not.toContain("ltx_listing_data")
    expect(result).not.toContain("@$")
    expect(result).toContain('<div class="ltx_listingline">n : ℕ</div>')
  })

  it("uses only the official arXiv HTML endpoint", async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes("arxiv.org")) return new Response(arxivHtml)
      throw new Error(`Unexpected URL: ${url}`)
    })
    const html = await acquire({
      context: { fetch: fetchMock, url: "https://arxiv.org/abs/2511.03618v2" },
      html: "",
    })
    const tree = parser.parse(html)
    preExtract({ tree, context: { url: "https://arxiv.org/abs/2511.03618v2" } })
    const article = extract({ tree })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://arxiv.org/html/2511.03618v2")
    expect(html).toContain("ltx_document")
    expect(serializer.stringify(tree)).toContain('data-folo-content-source="arxiv-html"')
    expect(html).not.toContain("alphaxiv.org")
    expect(serializer.stringify(article?.contentTree)).toContain("Fallback arXiv full text")
  })

  it("falls back to the RSS content without contacting AlphaXiv", async () => {
    const rssContent = '<article class="ltx_document"><p>RSS fallback</p></article>'
    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.includes("arxiv.org")) {
        return new Response("Unavailable", { status: 503 })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const html = await acquire({
      context: { fetch: fetchMock, url: "https://arxiv.org/abs/2511.03618v2" },
      html: rssContent,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("alphaxiv.org"))).toBe(true)
    expect(html).toBe(rssContent)
  })

  it("normalizes numbered MathML tables into readable display equations", () => {
    const tree = parser.parse(`
      <article class="ltx_document">
        <table class="ltx_equation ltx_eqn_table">
          <tbody><tr>
            <td class="ltx_eqn_cell ltx_eqn_content">
              <math display="block" alttext="E = mc^2">
                <semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics>
              </math>
            </td>
            <td class="ltx_eqn_cell ltx_eqn_eqno">(1)</td>
          </tr></tbody>
        </table>
      </article>
    `)

    articleTransform({ tree })
    const result = serializer.stringify(tree)

    expect(result).not.toMatch(/<table[^>]*ltx_eqn_table/)
    expect(result).toContain('class="folo-arxiv-equation"')
    expect(result).toContain('data-math-source="tex"')
    expect(result).toContain('data-math-display="true"')
    expect(result).toContain(
      '<math data-math-display="true" data-math-source="tex">E = mc^2</math>',
    )
    expect(result).toContain('data-folo-content-role="equation-number">(1)</span>')
  })

  it("normalizes current LaTeXML equation rows whose content cell has no legacy class", () => {
    const tree = parser.parse(`
      <article class="ltx_document">
        <table class="ltx_equation ltx_eqn_table">
          <tbody><tr>
            <td class="ltx_eqn_cell ltx_eqn_center_padleft"></td>
            <td class="ltx_eqn_cell ltx_align_center">
              <math display="block" alttext="\\hat{\\theta}_t">
                <semantics><mi>θ</mi><annotation encoding="application/x-tex">\\hat{\\theta}_t</annotation></semantics>
              </math>
            </td>
            <td class="ltx_eqn_cell ltx_eqn_center_padright"></td>
            <td class="ltx_eqn_cell ltx_eqn_eqno"><span>(4)</span></td>
          </tr></tbody>
        </table>
      </article>
    `)

    articleTransform({ tree })
    const result = serializer.stringify(tree)

    expect(result).not.toMatch(/<table[^>]*ltx_eqn_table/)
    expect(result).not.toMatch(/<td[^>]*ltx_eqn_center_padleft/)
    expect(result).toContain(
      '<math data-math-display="true" data-math-source="tex">\\hat{\\theta}_t</math>',
    )
    expect(result).toContain('data-folo-content-role="equation-number"><span>(4)</span></span>')
  })

  it("uses semantic list markers and removes LaTeXML paragraph spacing artifacts", () => {
    const tree = parser.parse(`
      <article class="ltx_document">
        <ul class="ltx_itemize">
          <li class="ltx_item" style="list-style-type:none">
            <span class="ltx_tag ltx_tag_item">•</span>
            <div class="ltx_para"><p class="ltx_p">First contribution.</p></div>
          </li>
        </ul>
        <ol class="ltx_enumerate">
          <li class="ltx_item" style="list-style-type:none">
            <span class="ltx_tag ltx_tag_item">1.</span>
            <div class="ltx_para"><p class="ltx_p">First step.</p></div>
          </li>
        </ol>
      </article>
    `)

    articleTransform({ tree })
    const result = serializer.stringify(tree)

    expect(result).not.toMatch(/<span[^>]*ltx_tag_item/)
    expect(result).not.toMatch(/<li[^>]*list-style-type/)
    expect(result).toContain('<ul class="ltx_itemize">')
    expect(result).toContain('<ol class="ltx_enumerate">')
    expect(result).toContain('<div class="ltx_para"><p class="ltx_p">First contribution.</p></div>')
  })

  it("collapses pre-rendered KaTeX into one canonical math node", () => {
    const tree = parser.parse(`
      <section class="ltx_document">
        <p>This leads to an almost supermartingale inequality:</p>
        <div class="group/math-block relative"><div>
          <span class="katex-display"><span class="katex">
            <span class="katex-mathml">
              <math display="block" alttext="E[\\phi(x_{n+1})] \\leq E[\\phi(x_n)]">
                <semantics>
                  <mrow><mi>E</mi></mrow>
                  <annotation encoding="application/x-tex">E[\\phi(x_{n+1})] \\leq E[\\phi(x_n)]</annotation>
                </semantics>
              </math>
            </span>
            <span class="katex-html" aria-hidden="true">E[φ(xn+1)] ≤ E[φ(xn)]</span>
          </span></span>
        </div></div>
      </section>
    `)

    articleTransform({ tree })
    const result = serializer.stringify(tree)

    expect(result).not.toContain("katex-mathml")
    expect(result).not.toContain("katex-html")
    expect(result).not.toContain("E[φ(xn+1)]")
    expect(result.match(/<math\b/g)).toHaveLength(1)
    expect(result).toContain(
      '<math data-math-display="true" data-math-source="tex">E[\\phi(x_{n+1})] \\leq E[\\phi(x_n)]</math>',
    )
  })
})
