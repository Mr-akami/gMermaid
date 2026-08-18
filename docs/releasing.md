# Releasing `@mr-akami/gmermaid`

## Release flow

The `Release` workflow runs whenever `main` changes. tagpr creates or updates a
release pull request and assigns the next calendar version. Merging that pull
request causes the same workflow to:

1. create a `vYYYY.MMDD.MICRO` tag and GitHub Release;
2. run lint, tests, type checking, and the package build;
3. publish `@mr-akami/gmermaid` to npm using OIDC trusted publishing, run from
   `packages/mcp` with `--provenance` so npm attests the build.

No npm token is stored in GitHub.

## One-time repository setup

In GitHub, open **Settings → Actions → General → Workflow permissions** and:

- select **Read and write permissions**; and
- enable **Allow GitHub Actions to create and approve pull requests**.

The workflows also declare their minimum required permissions directly.

## Manual publish

Only `packages/mcp` is published; every other workspace package is
`private: true`. The published package is `@mr-akami/gmermaid` and it ships a
single `gmermaid` binary with two modes — `gmermaid` opens the editor and
`gmermaid mcp` speaks stdio MCP. The directory is still named `mcp` for
historical reasons; it is not a feature-limited build.

### 1. Authenticate

```sh
npm login          # web auth; must be run interactively in your own terminal
npm whoami         # expect: mr-akami
```

### 2. Verify from the repository root

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm --filter @mr-akami/gmermaid build
```

### 3. Inspect the tarball

```sh
cd packages/mcp
npm pack --dry-run --ignore-scripts
```

It must list `dist/cli.js`, `dist/editor.html`, `dist/review.html`, `README.md`,
and `LICENSE` — the editor and review HTML are bundled as single files, so the
package needs no build step on the consumer side. Smoke-test both modes:

```sh
node ./dist/cli.js --version
node ./dist/cli.js --help
```

### 4. Publish

```sh
cd packages/mcp
npm publish
```

`prepack` re-runs the full build, so the tarball always matches the current
source. `publishConfig.access` is `public`, which scoped packages need.

If the account requires a one-time password the command fails with `EOTP`;
re-run it with the code from your authenticator:

```sh
npm publish --otp=<6-digit code>
```

Web-based auth may instead print an `npmjs.com/auth/cli/...` URL — open it,
approve, and the publish continues. Success ends with
`+ @mr-akami/gmermaid@<version>`.

### 5. Verify the published package

```sh
npm view @mr-akami/gmermaid version bin
npx -y @mr-akami/gmermaid --version
```

A `404 Not Found` right after a successful publish usually is not the registry
lagging — safe-chain hides versions below its minimum package age, which makes a
brand-new version look absent. Confirm against the registry directly:

```sh
curl -s https://registry.npmjs.org/@mr-akami%2Fgmermaid | jq '{tags: .["dist-tags"], versions: (.versions | keys)}'
```

or re-run the `npm` command with `--safe-chain-skip-minimum-package-age`.

Subsequent versions are CalVer releases managed by tagpr.

## Configure npm trusted publishing

After the first package exists, open:

**npmjs.com → @mr-akami/gmermaid → Settings → Trusted Publisher → GitHub Actions**

Configure it with these exact values:

| Field | Value |
| --- | --- |
| Organization or user | `Mr-akami` |
| Repository | `gMermaid` |
| Workflow filename | `release.yml` |
| Allowed action | `npm publish` |

Do not configure an environment name unless the `publish` job in
`.github/workflows/release.yml` is also updated to use that environment.

Until this is configured the `publish` job fails with `401`; the manual publish
above stays the fallback.

After a successful OIDC release, set the package's publishing access to
**Require two-factor authentication and disallow tokens**, then revoke any
automation token that is no longer needed.

## Retiring `@gmermaid/mcp`

`@gmermaid/mcp@0.1.0` was published before the CLI and the MCP server were
merged into one package. It stays on npm as a pointer only:

```sh
npm deprecate @gmermaid/mcp "Renamed to gmermaid. Install it with: npx @mr-akami/gmermaid mcp"
```

Do not publish new versions under the old name — `@mr-akami/gmermaid` covers
both the editor (`npx @mr-akami/gmermaid`) and the MCP server (`npx @mr-akami/gmermaid mcp`).

## Recovery

The publish command is intentionally in the tagpr workflow. Tags created with
the default `GITHUB_TOKEN` do not start a second tag-triggered workflow.

If verification or npm publication fails after tagpr creates a release, first
check whether the version already exists:

```sh
npm view @mr-akami/gmermaid@<version> version
```

If it does not exist, open **Actions → Release → Run workflow**, select `main`,
enter the version (without the `v` prefix) in **Publish an existing tagged
version**, and run it. The workflow checks out that tag and verifies its
`package.json` version before publishing.
