# Reusable Actions for NeoTamia

This repository contains a collection of [reusable actions](https://docs.github.com/en/actions/using-workflows/reusing-workflows) for NeoTamia.

## Available Actions

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
  with:
    runs-on: "['self-hosted']" # Optional
```
