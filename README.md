# Reusable Actions for NeoTamia

This repository contains a collection of [reusable actions](https://docs.github.com/en/actions/using-workflows/reusing-workflows) for NeoTamia.

## Available Actions

- [JVM Build and Publish](./.github/workflows/jvm-build-and-publish.yml)

This action is used to automatically build and publish a java/kotlin project to a Maven repository.

### Usage

```yaml
build-and-publish:
  uses: NeoTamia/actions/.github/workflows/jvm-build-and-publish.yml@main
  with:
    publish: true # Optional
    release: false # Optional
    java-version: "21" # Optional
    java-distribution: "zulu" # Optional
    build-cache: "gradle" # Optional
    build-command: "./gradlew build" # Optional
    publish-command: "./gradlew publish" # Optional
    artifacts-to-upload-path: "build/repo/*.jar" # Optional
    retention-days: 4 # Optional
    runs-on: "['ubuntu-latest']" # Optional
  secrets: inherit
  #or
  secrets:
    MAVEN_USERNAME: ${{ secrets.MAVEN_USERNAME }}
    MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
```

- [JVM Build](./.github/workflows/jvm-build.yml)

This action is used to automatically build a java/kotlin project.

### Usage

```yaml
build:
  uses: NeoTamia/actions/.github/workflows/jvm-build.yml@main
  with:
    java-version: "21" # Optional
    java-distribution: "zulu" # Optional
    build-cache: "gradle" # Optional
    build-command: "./gradlew build" # Optional
    default-branch: "main" # Optional
    artifacts-to-upload-path: "build/repo/*.jar" # Optional
    retention-days: 4 # Optional
    runs-on: "['ubuntu-latest']" # Optional
```

- [JVM Publish](./.github/workflows/jvm-publish.yml)

This action is used to automatically publish a java/kotlin project to a Maven repository.

### Usage

```yaml
publish:
  uses: NeoTamia/actions/.github/workflows/jvm-publish.yml@main
  with:
    release: false # Optional
    java-version: "21" # Optional
    java-distribution: "zulu" # Optional
    build-cache: "gradle" # Optional
    publish-command: "./gradlew publish" # Optional
    default-branch: "main" # Optional
    runs-on: "['ubuntu-latest']" # Optional
  secrets: inherit
  #or
  secrets:
    MAVEN_USERNAME: ${{ secrets.MAVEN_USERNAME }}
    MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
```

- [JVM Test](./.github/workflows/jvm-test.yml)

This action is used to automatically run tests for a java/kotlin project.

### Usage

```yaml
test:
  uses: NeoTamia/actions/.github/workflows/jvm-test.yml@main
  permissions:
    checks: write
    pull-requests: write
  with:
    java-version: "21" # Optional
    java-distribution: "zulu" # Optional
    build-cache: "gradle" # Optional
    test-command: "./gradlew test" # Optional
    publish-test-report: "true" # Optional
    fail-on-test-failure: "true" # Optional
    retention-days: 4 # Optional
    runs-on: "['ubuntu-latest']" # Optional
```

- [Todo](./.github/workflows/todo.yml)

This action is used to automatically create a new issue when a commit containing the word `todo` or `fixme` is pushed to a branch.

### Usage

```yaml
todo:
  uses: NeoTamia/actions/.github/workflows/todo.yml@main
  permissions:
    issues: write
    contents: read
  with:
    runs-on: "['self-hosted']" # Optional
    MANUAL_COMMIT_REF: <commit_sha> # Only for manual runs
    MANUAL_BASE_REF: <commit_sha> # Only for manual runs
```

- [Release Please](./.github/workflows/release-please.yml)

This action is used to automatically create a new release PR when a commit is pushed to the dev branch.

### Usage

```yaml
release-please:
  uses: NeoTamia/actions/.github/workflows/release-please.yml@main
  permissions:
    contents: write
    pull-requests: write
  with:
    target-branch: "dev" # Optional
    default-branch: "main" # Optional
    config-file: ".release-please-config.json" # Optional
    manifest-file: ".release-please-manifest.json" # Optional
    runs-on: "['ubuntu-latest']" # Optional
    committer-email: "47529956+alwyn974@users.noreply.github.com" # Optional
    committer-name: "alwyn974" # Optional
    client-id: ${{ vars.RELEASE_PLEASE_CLIENT_ID }} # Optional
  secrets: inherit
  # or
  secrets:
    RELEASE_PLEASE_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_PRIVATE_KEY }}
```

- [Gitflow Release](./.github/workflows/gitflow-release.yml)

This action is used to automatically create a gitflow release when a release PR is merged.

### Usage

```yaml
gitflow-release:
  uses: NeoTamia/actions/.github/workflows/gitflow-release.yml@main
  permissions:
    contents: write
  with:
    tag-name: "<tag_name>" # Required
    version: "<version>" # Required
    target-branch: "dev" # Optional
    default-branch: "main" # Optional
    runs-on: "['ubuntu-latest']" # Optional
    committer-email: "47529956+alwyn974@users.noreply.github.com" # Optional
    committer-name: "alwyn974" # Optional
    client-id: ${{ vars.RELEASE_PLEASE_CLIENT_ID }} # Optional
  secrets: inherit
  # or
  secrets:
    RELEASE_PLEASE_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_PRIVATE_KEY }}
```

- [Template Sync](./.github/workflows/template-sync.yml)

Pushes updates from a template repository into the repositories created from it.
The engine is stack-agnostic: Gradle, Node, monorepos, and anything else share the
same reusable workflow. Each template describes *its* files and identity tokens in
`.github/template-sync.yml`.

Nested templates (for example `plugin-template` generated from `kotlin-template`)
receive a PR first; after it is merged, their own Template Sync workflow fans out
to *their* generated repositories.

Strategies:

- `overwrite` — copy after rewriting the dest project identity
- `merge_toml` — template keys win, dest-only keys are kept (Gradle version catalogs)
- `merge_json` — same idea, deep-merge (`package.json` in Node / monorepos)
- `three_way` — apply the template delta since the last sync (customized files)
- `exclude` — never touch these paths (`src/**`, `README.md`, lockfiles, setup workflows)

Built-in identity tokens, derived from the GitHub owner/repo name:

| Token | Example (`NeoTamia/kotlin-template`) |
|---|---|
| `{owner}` | `NeoTamia` |
| `{owner_lower}` | `neotamia` |
| `{owner_slug}` | `neotamia` |
| `{kebab}` | `kotlin-template` |
| `{pascal}` | `KotlinTemplate` |
| `{camel}` | `kotlinTemplate` |
| `{display}` | `Kotlin Template` |
| `{slug}` | `kotlintemplate` |

Stack-specific strings go under `identity.extra`. The key is the literal in the
template; the value is interpolated for the destination repo:

```yaml
# Gradle / Kotlin
identity:
  extra:
    re.neotamia.kotlintemplate: re.{owner_slug}.{slug}
    neotamia-build: "{slug}-build"

# Node / monorepo
identity:
  extra:
    "@neotamia/monorepo-template": "@{owner_lower}/{kebab}"
    NeoTamia/monorepo-template: "{owner}/{kebab}"
    ghcr.io/neotamia: "ghcr.io/{owner_lower}"
```

The GitHub App (same one as Release Please) must be installed on the template
and on every downstream repository, with `contents: write`, `pull-requests: write`,
`metadata: read`, and `workflows: write`.

### Usage

```yaml
name: Template Sync

on:
  push:
    branches:
      - dev
      - main
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Log the repos and files that would change, without opening PRs"
        type: boolean
        default: false
      draft_pr:
        description: "Open downstream PRs as drafts"
        type: boolean
        default: false

concurrency:
  group: template-sync
  cancel-in-progress: false

jobs:
  sync:
    name: Sync generated repositories
    if: ${{ github.event.repository.is_template }}
    uses: NeoTamia/actions/.github/workflows/template-sync.yml@main
    permissions:
      contents: read
    secrets: inherit
    with:
      dry_run: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || false }}
      draft_pr: ${{ github.event_name == 'workflow_dispatch' && inputs.draft_pr || false }}
```

- [JVM Lint](./.github/workflows/jvm-lint.yml)

This action is used to automatically run lint checks for a java/kotlin project.

### Usage

```yaml
lint:
  uses: NeoTamia/actions/.github/workflows/jvm-lint.yml@main
  permissions:
    contents: read
    checks: write
    issues: write
    pull-requests: write
  with:
    java-version: "21" # Optional
    java-distribution: "zulu" # Optional
    build-cache: "gradle" # Optional
    lint-command: "./gradlew spotlessCheck" # Optional
    runs-on: "['ubuntu-latest']" # Optional
```
