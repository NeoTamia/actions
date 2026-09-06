import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyFile,
  defaultConfig,
  identityFromRepo,
  interpolate,
  loadConfig,
  mapPath,
  mergeJson,
  mergeToml,
  parseSimpleYaml,
  pathMatches,
  replacementPairs,
  substitute,
  threeWayMerge,
} from "./lib.mjs";

function gradleConfig() {
  const config = defaultConfig();
  config.overwrite.push(
    ".github/workflows/build.yml",
    "gradle/wrapper/**",
    "settings.gradle.kts",
  );
  config.merge_toml = ["gradle/libs.versions.toml"];
  config.three_way.push("buildSrc/src/main/kotlin/*-build.gradle.kts", "gradle.properties");
  config.exclude.push(".github/workflows/project-setup.yml", "modules/**");
  config.identity.extra = {
    "re.neotamia.kotlintemplate": "re.{owner_slug}.{slug}",
    "neotamia-build": "{slug}-build",
  };
  config.identity.owner_files = [
    "README.md",
    "CONTRIBUTING.md",
    "settings.gradle.kts",
    "buildSrc/src/main/kotlin/*-build.gradle.kts",
  ];
  return config;
}

test("tree glob matches wrapper files", () => {
  assert.equal(pathMatches("gradle/wrapper/gradle-wrapper.properties", "gradle/wrapper/**"), true);
  assert.equal(pathMatches("gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/**"), true);
  assert.equal(pathMatches("gradle/libs.versions.toml", "gradle/wrapper/**"), false);
});

test("filename glob matches convention plugin", () => {
  assert.equal(
    pathMatches(
      "buildSrc/src/main/kotlin/neotamia-build.gradle.kts",
      "buildSrc/src/main/kotlin/*-build.gradle.kts",
    ),
    true,
  );
});

test("yaml parser reads lists, bools, and nested identity maps", () => {
  const parsed = parseSimpleYaml(`
discover: true
prefer_branch: dev
exclude_repos:
  - archived-demo
overwrite:
  - .editorconfig
  - gradle/wrapper/**
identity:
  extra:
    re.neotamia.kotlintemplate: re.{owner_slug}.{slug}
    neotamia-build: "{slug}-build"
  owner_files:
    - README.md
    - settings.gradle.kts
`.trim());
  assert.equal(parsed.discover, true);
  assert.equal(parsed.prefer_branch, "dev");
  assert.deepEqual(parsed.exclude_repos, ["archived-demo"]);
  assert.deepEqual(parsed.overwrite, [".editorconfig", "gradle/wrapper/**"]);
  assert.equal(parsed.identity.extra["re.neotamia.kotlintemplate"], "re.{owner_slug}.{slug}");
  assert.equal(parsed.identity.extra["neotamia-build"], "{slug}-build");
  assert.deepEqual(parsed.identity.owner_files, ["README.md", "settings.gradle.kts"]);
});

test("identityFromRepo is stack-agnostic", () => {
  const kotlin = identityFromRepo("NeoTamia", "kotlin-template");
  assert.equal(kotlin.package, undefined);
  assert.equal(kotlin.kebab, "kotlin-template");
  assert.equal(kotlin.pascal, "KotlinTemplate");
  assert.equal(kotlin.camel, "kotlinTemplate");
  assert.equal(kotlin.display, "Kotlin Template");
  assert.equal(kotlin.slug, "kotlintemplate");
  assert.equal(kotlin.owner_lower, "neotamia");
  assert.equal(kotlin.owner_slug, "neotamia");
  assert.equal(interpolate("re.{owner_slug}.{slug}", kotlin), "re.neotamia.kotlintemplate");
  assert.equal(interpolate("@{owner_lower}/{kebab}", kotlin), "@neotamia/kotlin-template");

  const node = identityFromRepo("Acme", "my-app");
  assert.equal(interpolate("@{owner_lower}/{kebab}-config", node), "@acme/my-app-config");
  assert.equal(interpolate("{slug}-build", identityFromRepo("NeoTamia", "plugin-template")), "plugintemplate-build");
});

test("gradle extras rewrite package, convention plugin, and path", () => {
  const source = identityFromRepo("NeoTamia", "kotlin-template");
  const dest = identityFromRepo("NeoTamia", "plugin-template");
  const config = gradleConfig();
  const rewritten = substitute(
    'val baseGroup = "re.neotamia.kotlintemplate"\nid("neotamia-build")\n',
    source,
    dest,
    "buildSrc/src/main/kotlin/neotamia-build.gradle.kts",
    config,
  );
  assert.match(rewritten, /re\.neotamia\.plugintemplate/);
  assert.match(rewritten, /plugintemplate-build/);
  assert.equal(
    mapPath("buildSrc/src/main/kotlin/neotamia-build.gradle.kts", source, dest, config),
    "buildSrc/src/main/kotlin/plugintemplate-build.gradle.kts",
  );
});

test("npm extras rewrite scoped packages without touching dest-only names", () => {
  const source = identityFromRepo("NeoTamia", "monorepo-template");
  const dest = identityFromRepo("Acme", "shop");
  const config = defaultConfig();
  config.identity.extra = {
    "@neotamia/monorepo-template": "@{owner_lower}/{kebab}",
    "NeoTamia/monorepo-template": "{owner}/{kebab}",
    "ghcr.io/neotamia": "ghcr.io/{owner_lower}",
  };
  const rewritten = substitute(
    '{"name":"@neotamia/monorepo-template-config","registry":"ghcr.io/neotamia"}',
    source,
    dest,
    "packages/config/package.json",
    config,
  );
  assert.equal(rewritten, '{"name":"@acme/shop-config","registry":"ghcr.io/acme"}');
  const pairs = replacementPairs(source, dest, config.identity.extra);
  assert.equal(pairs[0][0].length >= pairs[1][0].length, true);
});

test("mergeToml updates shared keys and keeps dest extras", () => {
  const template = `# catalog
[versions]
kotlin = "2.4.10"
shadow = "9.6.1"

[libraries]
kotlinGradlePlugin = { module = "org.jetbrains.kotlin:kotlin-gradle-plugin", version.ref = "kotlin" }

[plugins]
kotlin = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
`;
  const dest = `# catalog
[versions]
kotlin = "2.3.21"
shadow = "9.4.2"
paperweight = "2.0.0-beta.21"

[libraries]
kotlinGradlePlugin = { module = "org.jetbrains.kotlin:kotlin-gradle-plugin", version.ref = "kotlin" }
papermcApi = { module = "io.papermc.paper:paper-api", version.ref = "papermc" }

[plugins]
kotlin = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
paperweight = { id = "io.papermc.paperweight.userdev", version.ref = "paperweight" }
`;
  const merged = mergeToml(template, dest);
  assert.match(merged, /kotlin = "2\.4\.10"/);
  assert.match(merged, /shadow = "9\.6\.1"/);
  assert.match(merged, /paperweight = /);
  assert.match(merged, /papermcApi/);
  assert.match(merged, /paperweight = \{ id/);
});

test("mergeJson updates shared deps and keeps dest-only keys", () => {
  const template = `{
  "name": "@acme/shop",
  "devDependencies": {
    "typescript": "6.0.3",
    "turbo": "2.10.9"
  }
}
`;
  const dest = `{
  "name": "@acme/shop",
  "devDependencies": {
    "typescript": "5.9.0",
    "eslint": "9.0.0"
  },
  "scripts": {
    "dev": "custom"
  }
}
`;
  const merged = JSON.parse(mergeJson(template, dest));
  assert.equal(merged.devDependencies.typescript, "6.0.3");
  assert.equal(merged.devDependencies.turbo, "2.10.9");
  assert.equal(merged.devDependencies.eslint, "9.0.0");
  assert.equal(merged.scripts.dev, "custom");
});

test("three-way merge preserves dest custom lines", () => {
  const ancestor = "aaa\nbbb\nccc\nddd\neee\n";
  const dest = "aaa\nbbb\nccc\nddd\ncustom\n";
  const incoming = "changed\nbbb\nccc\nddd\neee\n";
  const { text, conflict } = threeWayMerge(ancestor, dest, incoming);
  assert.equal(conflict, false);
  assert.match(text, /changed/);
  assert.match(text, /custom/);
});

test("defaults are stack-agnostic; gradle files need template config", () => {
  const defaults = defaultConfig();
  assert.equal(classifyFile("gradle/libs.versions.toml", defaults), null);
  assert.equal(classifyFile("package.json", defaults), null);
  assert.equal(classifyFile("AGENTS.md", defaults), "three_way");
  assert.equal(classifyFile(".github/workflows/build.yml", defaults), null);
  assert.equal(classifyFile(".editorconfig", defaults), "overwrite");
  assert.equal(
    classifyFile(".github/workflows/template-sync.yml", defaults, { destIsTemplate: false }),
    null,
  );

  const gradle = gradleConfig();
  assert.equal(classifyFile("gradle/libs.versions.toml", gradle), "merge_toml");
  assert.equal(classifyFile("buildSrc/src/main/kotlin/neotamia-build.gradle.kts", gradle), "three_way");
  assert.equal(classifyFile("modules/core/src/main/kotlin/App.kt", gradle), null);
  assert.equal(classifyFile(".github/workflows/project-setup.yml", gradle), null);
  assert.equal(classifyFile(".github/workflows/build.yml", gradle), "overwrite");
});

test("loadConfig reads nested identity from a repo config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "template-sync-config-"));
  try {
    mkdirSync(join(dir, ".github"));
    writeFileSync(
      join(dir, ".github/template-sync.yml"),
      `discover: true
prefer_branch: dev
merge_json:
  - package.json
identity:
  extra:
    "@neotamia/monorepo-template": "@{owner_lower}/{kebab}"
  owner_files:
    - README.md
overwrite:
  - .editorconfig
`,
    );
    const config = loadConfig(dir);
    assert.equal(config.discover, true);
    assert.equal(config.prefer_branch, "dev");
    assert.deepEqual(config.overwrite, [".editorconfig"]);
    assert.deepEqual(config.merge_json, ["package.json"]);
    assert.equal(config.identity.extra["@neotamia/monorepo-template"], "@{owner_lower}/{kebab}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
