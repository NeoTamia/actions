# Reusable Actions for NeoTamia

This repository contains a collection of [reusable actions](https://docs.github.com/en/actions/using-workflows/reusing-workflows) for NeoTamia.

## Available Actions

- [JVM Build](./jvm-build.yml)

This action is used to automatically build a java/kotlin project.

### Usage

```yaml
build:
  uses: NeoTamia/actions/jvm-build.yml@main
  with:
    java-version: "21" # Optional
    java-distribution: "temurin" # Optional
    build-cache: "gradle" # Optional
    build-command: "./gradlew build" # Optional
    default-branch: "main" # Optional
    artifacts-to-upload-path: "build/repo/*.jar" # Optional
    retention-days: 4 # Optional
    runs-on: "['ubuntu-latest']" # Optional
```
