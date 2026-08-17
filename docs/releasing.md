# Releasing `@gmermaid/mcp`

## Release flow

The `Release` workflow runs whenever `main` changes. tagpr creates or updates a
release pull request and assigns the next calendar version. Merging that pull
request causes the same workflow to:

1. create a `vYYYY.MMDD.MICRO` tag and GitHub Release;
2. run lint, tests, type checking, and the package build;
3. create the npm tarball; and
4. publish `@gmermaid/mcp` to npm using OIDC trusted publishing.

No npm token is stored in GitHub.

## One-time repository setup

In GitHub, open **Settings → Actions → General → Workflow permissions** and:

- select **Read and write permissions**; and
- enable **Allow GitHub Actions to create and approve pull requests**.

The workflows also declare their minimum required permissions directly.

## First npm publish

npm trusted publishing is configured from an existing package's settings. For
the first publication only, authenticate locally with an npm account that can
publish packages in the `gmermaid` organization, then run from the repository
root:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm --filter @gmermaid/mcp build
pnpm --dir packages/mcp pack --pack-destination ../../artifacts
npm publish ./artifacts/gmermaid-mcp-0.1.0.tgz --access public
```

Inspect the tarball before publishing with:

```sh
tar -tzf ./artifacts/gmermaid-mcp-0.1.0.tgz
```

The initial `0.1.0` exists only to bootstrap the npm package. Subsequent
versions are CalVer releases managed by tagpr.

## Configure npm trusted publishing

After the first package exists, open:

**npmjs.com → @gmermaid/mcp → Settings → Trusted Publisher → GitHub Actions**

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

## Recovery

The publish command is intentionally in the tagpr workflow. Tags created with
the default `GITHUB_TOKEN` do not start a second tag-triggered workflow.

If verification or npm publication fails after tagpr creates a release, first
check whether the version already exists:

```sh
npm view @gmermaid/mcp@<version> version
```

If it does not exist, open **Actions → Release → Run workflow**, select `main`,
enter the version (without the `v` prefix) in **Publish an existing tagged
version**, and run it. The workflow checks out that tag and verifies its
`package.json` version before publishing.
