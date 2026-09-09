#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  STATE_PATH,
  classifyFile,
  identityFromRepo,
  isBinary,
  loadConfig,
  mapPath,
  substitute,
  threeWayMerge,
} from "./lib.mjs";

function run(args, { cwd, env, check = true, encoding = "utf8" } = {}) {
  try {
    const stdout = execFileSync(args[0], args.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      encoding,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const result = {
      status: error.status ?? 1,
      stdout: error.stdout ?? (encoding === "utf8" ? "" : Buffer.alloc(0)),
      stderr: error.stderr ?? "",
    };
    if (check) {
      const detail = typeof result.stderr === "string" ? result.stderr : "";
      const wrapped = new Error(`Command failed (${result.status}): ${args.join(" ")}\n${detail}`);
      wrapped.cause = error;
      throw wrapped;
    }
    return result;
  }
}

function gitShow(root, sha, relPath) {
  const result = run(["git", "show", `${sha}:${relPath}`], {
    cwd: root,
    check: false,
    encoding: "buffer",
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

function gitRevParse(root, rev) {
  const result = run(["git", "rev-parse", rev], { cwd: root, check: false });
  return result.status === 0 ? result.stdout.trim() : null;
}

function selectedSourceFiles(root, config, ancestorSha) {
  const paths = run(["git", "diff", "--name-only", "--no-renames", "-z", ancestorSha, "HEAD"], { cwd: root });
  return paths.stdout.split("\0").filter(Boolean)
    .map((relPath) => ({ relPath, strategy: classifyFile(relPath, config) }))
    .filter(({ strategy }) => strategy);
}

export function resolveAncestor(sourceRoot, destRoot, templateRepo, explicitBase) {
  const state = loadState(destRoot);
  if (state.template && state.template !== templateRepo) {
    throw new Error(`Sync state belongs to ${state.template}, not ${templateRepo}`);
  }
  let sha = state.sha || explicitBase;
  if (!sha) {
    // GitHub generates a new root commit but preserves the template tree.
    const roots = run(["git", "rev-list", "--max-parents=0", "HEAD"], { cwd: destRoot }).stdout.trim().split("\n");
    const trees = new Set(roots.map((root) => gitRevParse(destRoot, `${root}^{tree}`)));
    const history = run(["git", "log", "--format=%H %T", "HEAD"], { cwd: sourceRoot }).stdout.trim().split("\n");
    sha = history.map((line) => line.split(" ")).find(([, tree]) => trees.has(tree))?.[0];
  }
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha) ||
      run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], { cwd: sourceRoot, check: false }).status !== 0) {
    throw new Error("Cannot establish the template baseline. Set source_sha in the destination .github/template-sync.yml to the full template commit SHA used to create the project (or last integrated manually).");
  }
  return sha;
}

function loadState(root) {
  const path = join(root, STATE_PATH);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeState(root, templateRepo, sha) {
  const path = join(root, STATE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ template: templateRepo, sha }, null, 2)}\n`);
}

function ghJson(args, token, { check = true } = {}) {
  const result = run(["gh", ...args], {
    env: { GH_TOKEN: token, GITHUB_TOKEN: token },
    check,
  });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function appendOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  if (String(value).includes("\n")) {
    appendFileSync(file, `${name}<<EOF\n${value}\nEOF\n`);
  } else {
    appendFileSync(file, `${name}=${value}\n`);
  }
}

export function applyFile({
  sourceRoot,
  destRoot,
  relPath,
  strategy,
  sourceId,
  destId,
  ancestorSha,
  config,
}) {
  const destRel = mapPath(relPath, sourceId, destId, config);
  const destFile = join(destRoot, destRel);
  const raw = gitShow(sourceRoot, "HEAD", relPath);
  const baseRaw = gitShow(sourceRoot, ancestorSha, relPath);
  const before = existsSync(destFile) ? readFileSync(destFile) : null;
  const rewrite = (data) => data === null ? null : isBinary(data) ? data
    : Buffer.from(substitute(data.toString("utf8"), sourceId, destId, relPath, config));
  const incoming = rewrite(raw);
  const ancestor = rewrite(baseRaw);
  const equal = (a, b) => a === null || b === null ? a === b : a.equals(b);
  if (equal(ancestor, incoming) || equal(before, incoming)) return { changed: false, conflict: false };

  let output;
  let conflict = false;
  if (equal(before, ancestor)) {
    output = incoming;
  } else {
    if ([before, ancestor, incoming].some((data) => data && isBinary(data))) {
      throw new Error(`Binary conflict in ${destRel}; resolve the template change manually`);
    }
    const merged = threeWayMerge(ancestor?.toString("utf8") ?? "", before?.toString("utf8") ?? "", incoming?.toString("utf8") ?? "");
    output = Buffer.from(merged.text);
    conflict = merged.conflict;
    // Keep a local deletion when the merge produces no content.
    if (!conflict && before === null && output.length === 0) output = null;
  }

  if (equal(before, output)) return { changed: false, conflict };
  if (output === null) rmSync(destFile, { force: true });
  else {
    mkdirSync(dirname(destFile), { recursive: true });
    writeFileSync(destFile, output);
  }
  return { changed: true, conflict };
}

function resolveParent(destRoot, destRepo, token) {
  const destConfig = loadConfig(destRoot);
  let sourceRepo = destConfig.source || "";
  if (!sourceRepo) {
    const info = ghJson(["api", `repos/${destRepo}`], token);
    sourceRepo = info?.template_repository?.full_name || "";
  }
  if (!sourceRepo) return null;

  let ref = destConfig.source_ref || "";
  if (!ref) {
    const prefer = destConfig.prefer_branch || "dev";
    const branch = ghJson(["api", `repos/${sourceRepo}/branches/${prefer}`], token, { check: false });
    if (branch) ref = prefer;
    else {
      const srcInfo = ghJson(["api", `repos/${sourceRepo}`], token);
      ref = srcInfo?.default_branch || "main";
    }
  }
  return { repo: sourceRepo, ref };
}

function cloneSource(fullName, ref, dest, token) {
  run(
    ["gh", "repo", "clone", fullName, dest, "--", "--branch", ref],
    { env: { GH_TOKEN: token, GITHUB_TOKEN: token } },
  );
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dest: { type: "string", default: "." },
      "dest-repo": { type: "string" },
      source: { type: "string" },
      "template-repo": { type: "string" },
      token: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const destRoot = resolve(values.dest);
  const destRepo = values["dest-repo"] || process.env.GITHUB_REPOSITORY;
  if (!destRepo || !destRepo.includes("/")) {
    process.stderr.write("--dest-repo or GITHUB_REPOSITORY is required\n");
    return 1;
  }

  const token = values.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const localSource = values.source ? resolve(values.source) : "";
  let parent;
  if (localSource) {
    parent = {
      repo: values["template-repo"] || loadConfig(destRoot).source || destRepo,
      ref: "HEAD",
    };
  } else {
    if (!token) {
      process.stderr.write("A GitHub token is required to read the parent template\n");
      return 1;
    }
    parent = resolveParent(destRoot, destRepo, token);
  }
  if (!parent) {
    console.log("No parent template (not generated from a GitHub template, no `source` in config). Skip.");
    appendOutput("changed", "false");
    appendOutput("has_parent", "false");
    return 0;
  }

  console.log(`Pulling ${parent.repo}@${parent.ref} into ${destRepo}`);
  appendOutput("has_parent", "true");
  appendOutput("template", parent.repo);
  appendOutput("ref", parent.ref);

  const workDir = localSource ? "" : mkdtempSync(join(tmpdir(), "template-sync-"));
  const sourceRoot = localSource || join(workDir, "source");
  try {
    if (!localSource) cloneSource(parent.repo, parent.ref, sourceRoot, token);
    const sourceConfig = loadConfig(sourceRoot);
    const [sourceOwner, sourceName] = parent.repo.split("/");
    const [destOwner, destName] = destRepo.split("/");
    const sourceId = identityFromRepo(sourceOwner, sourceName);
    const destId = identityFromRepo(destOwner, destName);
    const headSha = gitRevParse(sourceRoot, "HEAD");
    const ancestorSha = resolveAncestor(sourceRoot, destRoot, parent.repo, loadConfig(destRoot).source_sha);
    const files = selectedSourceFiles(sourceRoot, sourceConfig, ancestorSha);
    console.log(`Template delta: ${ancestorSha}..${headSha}`);

    console.log(`Source identity: ${JSON.stringify(sourceId)}`);
    console.log(`Dest identity: ${JSON.stringify(destId)}`);
    console.log(`Files to consider: ${files.length}`);

    const changedFiles = [];
    const conflicts = [];
    for (const { relPath, strategy } of files) {
      const { changed, conflict } = applyFile({
        sourceRoot,
        destRoot,
        relPath,
        strategy,
        sourceId,
        destId,
        ancestorSha,
        config: sourceConfig,
      });
      const destRel = mapPath(relPath, sourceId, destId, sourceConfig);
      if (changed) changedFiles.push(destRel);
      if (conflict) conflicts.push(destRel);
    }

    const stateChanged = loadState(destRoot).sha !== headSha;
    if (!values["dry-run"]) writeState(destRoot, parent.repo, headSha);
    const changed = changedFiles.length > 0 || stateChanged;

    if (!changed) {
      console.log("Already up to date");
      appendOutput("changed", "false");
      return 0;
    }

    console.log("Changed files:");
    for (const path of changedFiles) console.log(`  - ${path}`);
    if (conflicts.length > 0) {
      console.log("Conflicts:");
      for (const path of conflicts) console.log(`  - ${path}`);
    }
    if (values["dry-run"]) {
      console.log("Dry run: files were applied locally but no PR will be opened");
    }

    const fileList = changedFiles.map((path) => `- \`${path}\``).join("\n") || "- (state only)";
    let body =
      `Automated sync from [\`${parent.repo}\`](https://github.com/${parent.repo}) ` +
      `(\`${parent.ref}\` @ \`${headSha.slice(0, 12)}\`).\n\n` +
      `Template delta: [\`${ancestorSha.slice(0, 12)}...${headSha.slice(0, 12)}\`](https://github.com/${parent.repo}/compare/${ancestorSha}...${headSha}).\n\n` +
      `Updated files:\n${fileList}\n`;
    if (conflicts.length > 0) {
      body +=
        "\nThis PR contains 3-way merge conflicts in:\n" +
        conflicts.map((path) => `- \`${path}\``).join("\n") +
        "\nPlease resolve the conflict markers before merging.\n";
    }
    appendOutput("changed", "true");
    appendOutput("sha", headSha);
    appendOutput("title", `chore(template): sync from ${parent.repo}`);
    appendOutput("body", body);
    appendOutput("draft", conflicts.length > 0 ? "true" : "false");
    return 0;
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
