# Releasing `gmermaid`

## Release flow

The `Release` workflow runs whenever `main` changes. tagpr creates or updates a
release pull request and assigns the next calendar version. Merging that pull
request causes the same workflow to:

1. create a `vYYYY.MMDD.MICRO` tag and GitHub Release;
2. run lint, tests, type checking, and the package build;
3. create the npm tarball; and
4. publish `gmermaid` to npm using OIDC trusted publishing.

No npm token is stored in GitHub.

## One-time repository setup

In GitHub, open **Settings → Actions → General → Workflow permissions** and:

- select **Read and write permissions**; and
- enable **Allow GitHub Actions to create and approve pull requests**.

The workflows also declare their minimum required permissions directly.

## First npm publish

npm trusted publishing is configured from an existing package's settings, so the
first publication is done manually. Authenticate locally with an npm account
that may publish `gmermaid`, then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm --filter gmermaid build
pnpm --dir packages/mcp pack --pack-destination ../../artifacts
npm publish ./artifacts/gmermaid-2026.817.0.tgz --access public
```

Inspect the tarball before publishing with:

```sh
tar -tzf ./artifacts/gmermaid-2026.817.0.tgz
```

It must contain `dist/cli.js`, `dist/editor.html`, `dist/review.html`, and
`README.md` — the editor and review HTML are bundled as single files, so the
package has no build step on the consumer side.

Verify both CLI modes from the tarball before publishing:

```sh
npm pack --dry-run   # sanity check the file list
node ./dist/cli.js --version
node ./dist/cli.js --help
```

Subsequent versions are CalVer releases managed by tagpr.

## Configure npm trusted publishing

After the first package exists, open:

**npmjs.com → gmermaid → Settings → Trusted Publisher → GitHub Actions**

Configure it with these exact values:

| Field | Value |
| --- | --- |
| Organization or user | `Mr-akami` |
| Repository | `gMermaid` |
| Workflow filename | `release.yml` |
| Allowed action | `npm publish` |

Do not configure an environment name unless the `publish` job in
`.github/workflows/release.yml` is also updated to use that environment.

After a successful OIDC release, set the package's publishing access to
**Require two-factor authentication and disallow tokens**, then revoke any
automation token that is no longer needed.

## Retiring `@gmermaid/mcp`

`@gmermaid/mcp@0.1.0` was published before the CLI and the MCP server were
merged into one package. It stays on npm as a pointer only:

```sh
npm deprecate @gmermaid/mcp "Renamed to gmermaid. Install it with: npx gmermaid mcp"
```

Do not publish new versions under the old name — the `gmermaid` package covers
both the editor (`npx gmermaid`) and the MCP server (`npx gmermaid mcp`).

## Recovery

The publish command is intentionally in the tagpr workflow. Tags created with
the default `GITHUB_TOKEN` do not start a second tag-triggered workflow.

If verification or npm publication fails after tagpr creates a release, first
check whether the version already exists:

```sh
npm view gmermaid@<version> version
```

If it does not exist, open **Actions → Release → Run workflow**, select `main`,
enter the version (without the `v` prefix) in **Publish an existing tagged
version**, and run it. The workflow checks out that tag and verifies its
`package.json` version before publishing.
