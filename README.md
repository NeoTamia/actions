# Reusable Actions for NeoTamia

This repository contains a collection of [reusable actions](https://docs.github.com/en/actions/using-workflows/reusing-workflows) for NeoTamia.

## Available Actions

- [JVM Build and Publish](./jvm-build-and-publish.yml)

This action is used to automatically build and publish a java/kotlin project to a Maven repository.

### Usage

```yaml
build-and-publish:
  uses: NeoTamia/actions/.github/workflows/jvm-build-and-publish.yml@main
  with:
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

- [JVM Build](./jvm-build.yml)

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

- [JVM Publish](./jvm-publish.yml)

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

- [JVM Test](./jvm-test.yml)

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
  uses: Streetless/actions/.github/workflows/release-please.yml@main
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
  secrets: inherit
  # or
  secrets:
    RELEASE_PLEASE_APP_ID: ${{ secrets.RELEASE_PLEASE_APP_ID }}
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
  secrets: inherit
  # or
  secrets:
    RELEASE_PLEASE_APP_ID: ${{ secrets.RELEASE_PLEASE_APP_ID }}
    RELEASE_PLEASE_PRIVATE_KEY: ${{ secrets.RELEASE_PLEASE_PRIVATE_KEY }}
```

- [JVM Lint](./jvm-lint.yml)

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
