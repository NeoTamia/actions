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
    client-id: ${{ vars.RELEASE_PLEASE_CLIENT_ID }} # Optional; falls back to RELEASE_PLEASE_APP_ID
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
    client-id: ${{ vars.RELEASE_PLEASE_CLIENT_ID }} # Optional; falls back to RELEASE_PLEASE_APP_ID
  secrets: inherit
  # or
  secrets:
    RELEASE_PLEASE_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_PRIVATE_KEY }}
```

## Migrate from App ID to Client ID

`actions/create-github-app-token` recommends the GitHub App Client ID instead of
the legacy numeric App ID. The Client ID is a public identifier and should be
stored as an Actions variable; the private key must remain an Actions secret.

1. Open the GitHub App settings and copy its **Client ID**.
2. In the organization or repository, open **Settings → Secrets and variables →
   Actions → Variables**.
3. Create a variable named `RELEASE_PLEASE_CLIENT_ID` containing the Client ID.
4. Pass the variable to both reusable release workflows when they are used:

```yaml
with:
  client-id: ${{ vars.RELEASE_PLEASE_CLIENT_ID }}
secrets: inherit
```

If secrets are mapped explicitly, keep the private key mapping:

```yaml
secrets:
  RELEASE_PLEASE_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_PRIVATE_KEY }}
```

The reusable workflows continue to use `RELEASE_PLEASE_APP_ID` when `client-id`
is omitted, so existing callers can migrate independently. Once every caller
passes `client-id`, remove the obsolete `RELEASE_PLEASE_APP_ID` secret from the
repository or organization.

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
