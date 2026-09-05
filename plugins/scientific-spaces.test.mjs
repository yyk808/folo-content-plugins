import { describe, expect, it } from "vitest"

import { normalizeScientificSpacesMath } from "./scientific-spaces.mjs"

describe("scientific spaces adapter", () => {
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
