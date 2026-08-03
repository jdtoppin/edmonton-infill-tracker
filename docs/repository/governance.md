# Repository governance

## Conventional commits

Use this shape for commit subjects and pull-request titles:

```text
<type>(optional-scope): short imperative description
```

Keep the subject concise, lowercase after the colon, and free of a trailing period. Explain motivation, tradeoffs, migrations, and operational effects in the body when they are not obvious.

Common types:

| Type       | Use                                    |
| ---------- | -------------------------------------- |
| `feat`     | User-visible capability                |
| `fix`      | Defect correction                      |
| `data`     | Dataset mapping or data-quality change |
| `refactor` | Behavior-preserving code change        |
| `perf`     | Measured performance improvement       |
| `test`     | Test-only change                       |
| `docs`     | Documentation-only change              |
| `build`    | Build system or container change       |
| `ci`       | GitHub Actions change                  |
| `chore`    | Maintenance that fits no other type    |

Examples:

```text
feat(alerts): add daily saved-search digest
fix(import): preserve records after one row fails validation
data(classifier): reduce renovation-only confidence
build(docker): add native Apple Silicon PostGIS image
```

Use `!` and a `BREAKING CHANGE:` footer only for intentionally incompatible changes. Squash-merge pull requests so the conventional PR title becomes the main-branch commit.

## Recommended branch protection

Protect `main` in GitHub repository settings with a ruleset:

1. Require a pull request before merging and at least one approving review.
2. Dismiss stale approvals when new commits are pushed.
3. Require review from code owners after a `CODEOWNERS` file with real maintainers is added.
4. Require all conversations to be resolved.
5. Require branches to be up to date before merging.
6. Require these exact status checks from `.github/workflows/ci.yml`:
   - `Quality`
   - `Integration`
   - `Production build`
   - `Container security`
   - `Playwright smoke`
7. Block force pushes and branch deletion.
8. Require linear history and allow squash merging.
9. Apply the rules to administrators, with an emergency bypass restricted to named maintainers and audited.
10. Require signed commits if every maintainer and approved automation can support them; do not weaken required CI to enable this.

Also enable secret scanning, push protection, Dependabot alerts, and private vulnerability reporting when they are available for the repository plan.

Container-scan exceptions must identify individual findings, a single affected path, an audit
reason, and an expiry date. The only current exception file is applied to the upstream `gosu`
binary in the PostGIS image. It follows the
[`gosu` security policy](https://github.com/tianon/gosu/blob/1.19/SECURITY.md), which requires
reachability analysis for generic Go standard-library reports. It does not suppress new CVE IDs,
other files, the application image, Caddy, PostgreSQL, PostGIS, or Debian packages. CI must fail
again when an exception expires so it is re-audited rather than silently becoming permanent.

Create the `bug`, `enhancement`, and `data-quality` labels referenced by the issue forms. Triage data-quality reports separately from software defects because upstream public-data errors, normalization problems, and classification-rule errors need different remedies.

## Pull-request expectations

- Keep changes small enough to review and deploy independently.
- Link an issue and state the observable outcome.
- Add or update tests for behavior changes.
- Treat migrations as forward-only production changes; include backup and rollback notes.
- Show how imports remain idempotent and alerts remain deduplicated when those areas change.
- Never paste production records, addresses beyond the minimum public evidence, user email addresses, tokens, or `.env` content into issues, commits, screenshots, or CI logs.
- Require human review for dependency major versions and database image changes. Dependabot groups only minor and patch npm updates automatically.
- Let the scheduled support-component workflow coordinate stable same-major Node.js, npm, npm bundled-dependency security overrides, Caddy, Caddy's Go toolchain/x-text/gRPC security pins, and PostgreSQL. Let Dependabot propose the remaining Caddy transitive Go dependency updates. Every Caddy build must verify the committed `go.sum` and compile with read-only module resolution. The support workflow may push only an isolated `codex/support-components-*` branch and may open a pull request only after a dispatched full CI run passes; neither update path may merge or deploy.

## Releases and deployment

Tag reviewed main-branch commits using semantic versions once releases begin. CI validates changes but does not deploy them. The Mac mini operator follows the backup-first manual update procedure in [Mac mini deployment](../deployment/mac-mini.md).

A future self-hosted GitHub Actions runner should use a dedicated low-privilege macOS account, a protected GitHub Environment with required approval, and a workflow that can run only from a reviewed tag or manual dispatch. Never expose the Docker socket to pull-request code, and never run untrusted fork workflows on the deployment runner.
