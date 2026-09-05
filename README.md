# Folo content plugins

Enhanced reading for AlphaXiv, arXiv, HelloGitHub, Google DeepMind, Google Developers,
Hugging Face, LinkResearcher, Meta AI, and Scientific Spaces. The collection contains
10 processors, 10 JavaScript modules and 39 sandboxed processing stages.

## Subscribe

In a Folo desktop build with **Plugin subscriptions** support, open
**Settings → Automation → Content processors**, enter:

```text
https://github.com/yyk808/folo-content-plugins
```

Preview the collection and its requested access, then choose **Trust and install**.
Folo downloads the latest stable Release and stores the code in its own application
data directory. No local source checkout or Documents folder access is needed.

Builds without the Plugin subscriptions setting must update the desktop client first.
This package requires content plugin host API version 1; a matching application
version number alone does not imply that capability is present.

Matching local modules can be migrated without duplicating processors. Customized
or different source files stay local. Updates preserve your personal overrides.
Added permissions require confirmation, failed updates retain the installed version,
and rolling back pauses automatic updates. Keep this repository URL to reinstall
the collection after clearing all application data. Account sync is not required
for installation and is not part of this package.

## Matching

Defaults match article URLs, without personal feed IDs or local file paths.
AlphaXiv Hot Papers additionally matches the public feed
`https://alphaxiv-rss.keeloxy.workers.dev/`. If you use another mirror whose entries
link directly to arXiv, add that feed URL to the processor's local matching settings.
The arXiv AI Overview processor has higher priority than the full-text processor
for abstract-page links. Priorities and matching rules can be customized in Folo.

## Develop and release

```sh
npm ci
npm test
npm run build
```

Edit `plugins/*.mjs`, `plugins/reading.css`, and `folo-plugins.manifest.json`.
The build recalculates file hashes, checks stage exports and creates the single
`dist/folo-plugins.json` Release asset. It does not bundle Node dependencies;
published modules run in Folo's QuickJS sandbox and use the host API.

For a new release, bump the manifest and package versions, commit the changes,
then push a matching `vX.Y.Z` tag. GitHub Actions runs tests and publishes the asset.
Never replace an existing release's content: publish a new version instead.

All stylesheet selectors must start with
`[data-folo-content-processor="PROCESSOR_ID"]`. Folo rewrites this to the installed
processor's namespace. Descendant/child selectors, Folo classes, LaTeXML classes,
`data-folo-content-role` selectors, and min/max-width media queries are supported.
External resources, imports, pseudo selectors, nesting, positioning, and `!important`
are intentionally excluded from this stylesheet API. Images use the declared
remote-media permission instead.

## License

AGPL-3.0-only. These modules and tests were extracted from the Folo content-pipeline
examples. See `LICENSE`.
