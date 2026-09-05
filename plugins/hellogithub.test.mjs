import { describe, expect, it } from "vitest"

import { renderHelloGitHubProject } from "./hellogithub.mjs"

const textContent = (node) =>
  node.type === "text" ? node.value : (node.children ?? []).map(textContent).join("")

const findElement = (node, predicate) => {
  if (node.type === "element" && predicate(node)) return node
  for (const child of node.children ?? []) {
    const result = findElement(child, predicate)
    if (result) return result
  }
  return null
}

describe("HelloGitHub adapter", () => {
  it("renders structured repository data without the surrounding application shell", () => {
    const result = renderHelloGitHubProject(
      {
        full_name: "owner/project",
        title: "一个好用的开源项目",
        summary: "项目的中文介绍。",
        description: "Original project description.",
        url: "https://github.com/owner/project",
        image_url: "https://img.example.com/project.png",
        primary_lang: "TypeScript",
        license_spdx_id: "MIT",
        stars: 12_345,
        forks: 678,
        open_issues: 9,
        contributors: 42,
        score_str: "9.5",
        volume_name: "124",
        tags: [{ name: "效率" }, { name: "CLI" }],
        star_history: { increment: 321 },
      },
      "https://hellogithub.com/repository/abc",
    )

    const content = textContent(result)
    const image = findElement(result, (element) => element.tagName === "img")
    expect(content).toContain("owner/project")
    expect(content).toContain("12,345")
    expect(content).toContain("+321")
    expect(content).toContain("TypeScript")
    expect(content).toContain("第 124 期")
    expect(content).toContain("GitHub 源码")
    expect(content).toContain("HelloGitHub 原页")
    expect(result.properties.dataFoloContentProcessor).toBe("hellogithub-enhanced")
    expect(image?.properties).toMatchObject({
      className: ["folo-hg-cover"],
      height: 80,
      width: 80,
    })
    expect(content).not.toContain("__NEXT_DATA__")
  })

  it("escapes repository-provided text", () => {
    const result = renderHelloGitHubProject(
      { full_name: "owner/<script>", summary: "<img src=x onerror=alert(1)>" },
      "https://hellogithub.com/repository/abc",
    )

    expect(textContent(result)).toContain("owner/<script>")
    expect(textContent(result)).toContain("<img src=x onerror=alert(1)>")
    expect(findElement(result, (element) => element.tagName === "script")).toBeNull()
  })
})
