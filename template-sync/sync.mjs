#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
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
  mergeJson,
  mergeToml,
  substitute,
  threeWayMerge,
} from "./lib.mjs";

const ZERO_SHA = "0".repeat(40);

function run(args, { cwd, env, input, check = true, encoding = "utf8" } = {}) {
  try {
    const stdout = execFileSync(args[0], args.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      input,
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

function gitLsFiles(root) {
  const result = run(["git", "ls-files", "-z"], { cwd: root });
  return result.stdout.split("\0").filter(Boolean).map((item) => item.replaceAll("\\", "/"));
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

function selectedSourceFiles(root, config) {
  const selected = [];
  for (const relPath of gitLsFiles(root)) {
    const strategy = classifyFile(relPath, config);
    if (strategy) selected.push({ relPath, strategy });
  }
  return selected;
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

function resolveTargetBranch(fullName, prefer, defaultBranch, token) {
  const info = ghJson(["api", `repos/${fullName}/branches/${prefer}`], token, { check: false });
  return info ? prefer : defaultBranch;
}

function discoverTargets(org, templateRepo, config, token) {
  const targets = new Map();

  if (config.discover) {
    const query = `
      query($login: String!, $cursor: String) {
        organization(login: $login) {
          repositories(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              name
              isTemplate
              isArchived
              defaultBranchRef { name }
              templateRepository { nameWithOwner }
            }
          }
        }
      }
    `;
    let cursor = null;
    while (true) {
      const args = ["api", "graphql", "-f", `query=${query}`, "-F", `login=${org}`];
      if (cursor) args.push("-F", `cursor=${cursor}`);
      const payload = ghJson(args, token);
      const repositories = payload.data.organization.repositories;
      for (const node of repositories.nodes) {
        const template = node.templateRepository?.nameWithOwner;
        if (template !== templateRepo) continue;
        if (config.skip_archived && node.isArchived) continue;
        const name = node.name;
        const fullName = `${org}/${name}`;
        if (fullName === templateRepo) continue;
        if (config.exclude_repos.includes(name) || config.exclude_repos.includes(fullName)) continue;
        targets.set(fullName, {
          fullName,
          name,
          isTemplate: Boolean(node.isTemplate),
          defaultBranch: node.defaultBranchRef?.name || "main",
          archived: Boolean(node.isArchived),
        });
      }
      if (!repositories.pageInfo.hasNextPage) break;
      cursor = repositories.pageInfo.endCursor;
    }
  }

  for (const extra of config.include_repos) {
    const fullName = extra.includes("/") ? extra : `${org}/${extra}`;
    if (fullName === templateRepo || targets.has(fullName)) continue;
    const info = ghJson(["api", `repos/${fullName}`], token);
    if (config.skip_archived && info.archived) continue;
    targets.set(fullName, {
      fullName,
      name: info.name,
      isTemplate: Boolean(info.is_template),
      defaultBranch: info.default_branch || "main",
      archived: Boolean(info.archived),
    });
  }

  return [...targets.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
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
  const sourceFile = join(sourceRoot, relPath);
  const destRel = mapPath(relPath, sourceId, destId, config);
  const destFile = join(destRoot, destRel);
  const raw = readFileSync(sourceFile);
  if (isBinary(raw)) {
    mkdirSync(dirname(destFile), { recursive: true });
    const before = existsSync(destFile) ? readFileSync(destFile) : null;
    if (before && Buffer.compare(before, raw) === 0) return { changed: false, conflict: false };
    writeFileSync(destFile, raw);
    return { changed: true, conflict: false };
  }

  const incoming = substitute(raw.toString("utf8"), sourceId, destId, relPath, config);
  const destExists = existsSync(destFile);
  const destText = destExists ? readFileSync(destFile, "utf8") : "";
  let conflict = false;
  let output;

  if (strategy === "merge_toml") {
    output = destExists ? mergeToml(incoming, destText) : incoming;
  } else if (strategy === "merge_json") {
    output = destExists ? mergeJson(incoming, destText) : incoming;
  } else if (strategy === "three_way" && destExists && ancestorSha) {
    const ancestorBlob = gitShow(sourceRoot, ancestorSha, relPath);
    if (ancestorBlob == null || isBinary(ancestorBlob)) {
      output = incoming;
    } else {
      const ancestor = substitute(ancestorBlob.toString("utf8"), sourceId, destId, relPath, config);
      const merged = threeWayMerge(ancestor, destText, incoming);
      output = merged.text;
      conflict = merged.conflict;
    }
  } else {
    output = incoming;
  }

  if (destExists && output === destText) return { changed: false, conflict: false };
  mkdirSync(dirname(destFile), { recursive: true });
  writeFileSync(destFile, output);
  return { changed: true, conflict };
}

function cloneRepo(fullName, branch, dest, token) {
  run(
    ["gh", "repo", "clone", fullName, dest, "--", "--branch", branch, "--single-branch", "--depth", "1"],
    { env: { GH_TOKEN: token, GITHUB_TOKEN: token } },
  );
}

function ensureLabel(fullName, token) {
  run(
    [
      "gh",
      "label",
      "create",
      "template-sync",
      "--repo",
      fullName,
      "--description",
      "Automated updates from the parent template",
      "--color",
      "0E8A16",
      "--force",
    ],
    { env: { GH_TOKEN: token, GITHUB_TOKEN: token }, check: false },
  );
}

function openOrUpdatePr({ fullName, base, head, title, body, token, draft }) {
  const existing = ghJson(
    ["pr", "list", "--repo", fullName, "--head", head, "--base", base, "--json", "url,number"],
    token,
  ) || [];
  if (existing.length > 0) {
    run(
      ["gh", "pr", "edit", String(existing[0].number), "--repo", fullName, "--body", body, "--title", title],
      { env: { GH_TOKEN: token, GITHUB_TOKEN: token }, check: false },
    );
    return existing[0].url;
  }
  const cmd = [
    "gh",
    "pr",
    "create",
    "--repo",
    fullName,
    "--base",
    base,
    "--head",
    head,
    "--title",
    title,
    "--body",
    body,
    "--label",
    "template-sync",
  ];
  if (draft) cmd.push("--draft");
  const result = run(cmd, { env: { GH_TOKEN: token, GITHUB_TOKEN: token }, check: false });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    return null;
  }
  return result.stdout.trim();
}

function syncTarget({
  sourceRoot,
  sourceId,
  target,
  config,
  files,
  templateRepo,
  headSha,
  ancestorSha,
  token,
  dryRun,
  draft,
  workDir,
}) {
  const branch = resolveTargetBranch(target.fullName, config.prefer_branch, target.defaultBranch, token);
  if (target.name.includes("/") || target.name.includes("\\") || target.name === "." || target.name === "..") {
    throw new Error(`invalid target name: ${target.name}`);
  }
  const destRoot = resolve(workDir, target.name);
  if (destRoot === resolve(workDir) || !destRoot.startsWith(`${resolve(workDir)}/`)) {
    throw new Error(`refusing to write outside work dir: ${destRoot}`);
  }
  console.log(`::group::Sync ${target.fullName} (base: ${branch})`);
  cloneRepo(target.fullName, branch, destRoot, token);
  const destId = identityFromRepo(target.fullName.split("/")[0], target.name);
  const destAncestor = loadState(destRoot).sha || ancestorSha;
  const changedFiles = [];
  const conflicts = [];

  for (const { relPath, strategy } of files) {
    const effective = classifyFile(relPath, config, { destIsTemplate: target.isTemplate });
    if (!effective) continue;
    const { changed, conflict } = applyFile({
      sourceRoot,
      destRoot,
      relPath,
      strategy: effective,
      sourceId,
      destId,
      ancestorSha: destAncestor,
      config,
    });
    const destRel = mapPath(relPath, sourceId, destId, config);
    if (changed) changedFiles.push(destRel);
    if (conflict) conflicts.push(destRel);
  }

  writeState(destRoot, templateRepo, headSha);
  const status = run(["git", "status", "--porcelain"], { cwd: destRoot });
  if (changedFiles.length === 0 && !status.stdout.trim()) {
    console.log("Already up to date");
    console.log("::endgroup::");
    return null;
  }

  console.log("Changed files:");
  for (const path of changedFiles) console.log(`  - ${path}`);
  if (dryRun) {
    console.log("Dry run: skipping commit/PR");
    console.log("::endgroup::");
    return null;
  }

  run(["git", "config", "user.name", "github-actions[bot]"], { cwd: destRoot });
  run(
    ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
    { cwd: destRoot },
  );
  run(["git", "checkout", "-B", "chore/template-sync"], { cwd: destRoot });
  run(["git", "add", "-A"], { cwd: destRoot });
  const commit = run(
    ["git", "commit", "-m", `chore(template): sync from ${templateRepo}`],
    { cwd: destRoot, check: false },
  );
  if (commit.status !== 0) {
    console.log("No commit created");
    console.log("::endgroup::");
    return null;
  }
  run(["git", "push", "-u", "origin", "chore/template-sync", "--force"], {
    cwd: destRoot,
    env: { GH_TOKEN: token, GITHUB_TOKEN: token, GIT_TERMINAL_PROMPT: "0" },
  });
  ensureLabel(target.fullName, token);
  const fileList = changedFiles.map((path) => `- \`${path}\``).join("\n") || "- (state only)";
  let conflictNote = "";
  if (conflicts.length > 0) {
    conflictNote =
      "\n\nThis PR contains 3-way merge conflicts in:\n" +
      conflicts.map((path) => `- \`${path}\``).join("\n") +
      "\nPlease resolve the conflict markers before merging.";
  }
  let cascadeNote = "";
  if (target.isTemplate) {
    cascadeNote =
      "\n\nThis repository is itself a template. After merging, its own " +
      "`Template Sync` workflow will open PRs on repositories created from it.";
  }
  const body =
    `Automated sync from [\`${templateRepo}\`](https://github.com/${templateRepo}) ` +
    `at \`${headSha.slice(0, 12)}\`.\n\n` +
    `Updated files:\n${fileList}` +
    `${conflictNote}${cascadeNote}\n`;
  const url = openOrUpdatePr({
    fullName: target.fullName,
    base: branch,
    head: "chore/template-sync",
    title: `chore(template): sync from ${templateRepo}`,
    body,
    token,
    draft: draft || conflicts.length > 0,
  });
  console.log(url || "PR was not created");
  console.log("::endgroup::");
  return url;
}

function resolveAncestorSha(sourceRoot, beforeSha) {
  if (beforeSha && beforeSha !== ZERO_SHA) return beforeSha;
  return gitRevParse(sourceRoot, "HEAD^");
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string", default: "." },
      org: { type: "string" },
      "template-repo": { type: "string" },
      token: { type: "string" },
      "head-sha": { type: "string" },
      "before-sha": { type: "string", default: "" },
      "dry-run": { type: "boolean", default: false },
      draft: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const token = values.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    process.stderr.write("A GitHub token is required\n");
    return 1;
  }
  if (!values.org || !values["template-repo"]) {
    process.stderr.write("--org and --template-repo are required\n");
    return 1;
  }

  const sourceRoot = resolve(values.source);
  const config = loadConfig(sourceRoot);
  const [owner, repoName] = values["template-repo"].split("/");
  const sourceId = identityFromRepo(owner, repoName);
  const files = selectedSourceFiles(sourceRoot, config);
  const headSha = values["head-sha"] || gitRevParse(sourceRoot, "HEAD");
  const ancestorSha = resolveAncestorSha(sourceRoot, values["before-sha"]);
  const targets = discoverTargets(values.org, values["template-repo"], config, token);

  console.log(`Source identity: ${JSON.stringify(sourceId)}`);
  console.log(`Files to consider: ${files.length}`);
  console.log(`Targets: ${targets.map((target) => target.fullName).join(", ") || "(none)"}`);
  if (targets.length === 0) {
    console.log("No downstream repositories found");
    return 0;
  }

  const prs = [];
  const workDir = mkdtempSync(join(tmpdir(), "template-sync-"));
  try {
    for (const target of targets) {
      try {
        const url = syncTarget({
          sourceRoot,
          sourceId,
          target,
          config,
          files,
          templateRepo: values["template-repo"],
          headSha,
          ancestorSha,
          token,
          dryRun: values["dry-run"],
          draft: values.draft,
          workDir,
        });
        if (url) prs.push(url);
      } catch (error) {
        console.log(`::error::Failed to sync ${target.fullName}: ${error.message}`);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  if (prs.length > 0) {
    console.log("Opened or updated PRs:");
    for (const url of prs) console.log(`  ${url}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
