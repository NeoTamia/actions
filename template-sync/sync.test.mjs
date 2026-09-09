import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { main, resolveAncestor } from "./sync.mjs";
import { STATE_PATH } from "./lib.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "template-sync-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const dest = join(root, "dest");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const put = (cwd, path, text) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const commit = (cwd) => { git(cwd, "add", "."); git(cwd, "commit", "-qm", "fixture"); return git(cwd, "rev-parse", "HEAD"); };
  for (const cwd of [source, dest]) {
    mkdirSync(cwd);
    git(cwd, "init", "-q");
    git(cwd, "config", "user.name", "Test");
    git(cwd, "config", "user.email", "test@example.com");
  }
  const config = "three_way:\n  - '*.txt'\nmerge_json:\n  - package.json\nmerge_toml:\n  - versions.toml\noverwrite:\n  - '*.bin'\n";
  for (const cwd of [source, dest]) {
    put(cwd, ".github/template-sync.yml", config);
    put(cwd, "template.txt", "first\n\nsecond\n\nthird\n");
  }
  const base = commit(source);
  commit(dest);
  const sync = (...args) => main(["--source", source, "--dest", dest, "--dest-repo", "Acme/app", "--template-repo", "Acme/template", ...args]);
  return { source, dest, git, put, commit, base, sync };
}

test("finds the original template tree across unrelated histories", (t) => {
  const f = fixture(t);
  f.put(f.dest, "custom.txt", "local\n"); f.commit(f.dest);
  f.put(f.source, "new.txt", "upstream\n"); f.commit(f.source);
  assert.equal(resolveAncestor(f.source, f.dest, "Acme/template"), f.base);
});

test("applies the cumulative delta, preserves local changes and is idempotent", (t) => {
  const f = fixture(t);
  f.put(f.dest, "app.txt", "first\n\nsecond\n\ncustom\n");
  rmSync(join(f.dest, "template.txt"));
  f.put(f.dest, "local.txt", "keep\n"); f.commit(f.dest);
  f.put(f.source, "template.txt", "updated\n\nsecond\n\nthird\n"); f.commit(f.source);
  f.put(f.source, "new.txt", "added\n"); const head = f.commit(f.source);
  assert.equal(f.sync(), 0);
  assert.equal(readFileSync(join(f.dest, "app.txt"), "utf8"), "updated\n\nsecond\n\ncustom\n");
  assert.equal(readFileSync(join(f.dest, "local.txt"), "utf8"), "keep\n");
  assert.equal(JSON.parse(readFileSync(join(f.dest, STATE_PATH))).sha, head);
  f.commit(f.dest);
  assert.equal(f.sync(), 0);
  assert.equal(f.git(f.dest, "status", "--porcelain"), "");
});

test("does not reintroduce unchanged files deleted locally", (t) => {
  const f = fixture(t);
  rmSync(join(f.dest, "template.txt")); f.commit(f.dest);
  f.put(f.source, "new.txt", "new\n"); f.commit(f.source);
  f.sync();
  assert.equal(existsSync(join(f.dest, "app.txt")), false);
});

test("applies upstream deletions and treats renames as delete/add", (t) => {
  const f = fixture(t);
  f.put(f.dest, "app.txt", readFileSync(join(f.dest, "template.txt")));
  rmSync(join(f.dest, "template.txt")); f.commit(f.dest);
  f.git(f.source, "mv", "template.txt", "renamed.txt"); f.commit(f.source);
  f.sync();
  assert.equal(existsSync(join(f.dest, "app.txt")), false);
  assert.equal(existsSync(join(f.dest, "renamed.txt")), true);
});

test("keeps real text conflicts visible", (t) => {
  const f = fixture(t);
  f.put(f.dest, "app.txt", "local\n\nsecond\n\nthird\n"); f.commit(f.dest);
  f.put(f.source, "template.txt", "upstream\n\nsecond\n\nthird\n"); f.commit(f.source);
  f.sync();
  assert.match(readFileSync(join(f.dest, "app.txt"), "utf8"), /<<<<<<< dest/);
});

test("requires a verified baseline instead of guessing HEAD^", (t) => {
  const f = fixture(t);
  f.git(f.dest, "checkout", "--orphan", "unrelated");
  f.put(f.dest, "custom.txt", "different root\n"); f.commit(f.dest);
  assert.throws(() => resolveAncestor(f.source, f.dest, "Acme/template"), /source_sha/);
  assert.equal(resolveAncestor(f.source, f.dest, "Acme/template", f.base), f.base);
  f.put(f.dest, STATE_PATH, JSON.stringify({ template: "Acme/other", sha: f.base }));
  assert.throws(() => resolveAncestor(f.source, f.dest, "Acme/template"), /belongs to/);
});

test("dry run leaves sync state untouched", (t) => {
  const f = fixture(t);
  f.put(f.source, "new.txt", "new\n"); f.commit(f.source);
  f.sync("--dry-run");
  assert.equal(existsSync(join(f.dest, STATE_PATH)), false);
  assert.equal(existsSync(join(f.dest, "new.txt")), true);
});

test("JSON and TOML only apply changed upstream lines, preserving local keys", (t) => {
  const f = fixture(t);
  for (const cwd of [f.source, f.dest]) {
    f.put(cwd, "package.json", '{\n  "version": "1",\n  "name": "app",\n  "private": true,\n  "custom": false\n}\n');
    f.put(cwd, "versions.toml", '[versions]\na = "1"\nb = "1"\nc = "1"\nlocal = "1"\n');
  }
  const baseline = f.commit(f.source); f.commit(f.dest);
  f.put(f.dest, STATE_PATH, JSON.stringify({ template: "Acme/template", sha: baseline }));
  f.put(f.dest, "package.json", readFileSync(join(f.dest, "package.json"), "utf8").replace('"custom": false', '"custom": true'));
  f.put(f.dest, "versions.toml", readFileSync(join(f.dest, "versions.toml"), "utf8").replace('local = "1"', 'local = "custom"'));
  f.commit(f.dest);
  f.put(f.source, "package.json", readFileSync(join(f.source, "package.json"), "utf8").replace('"version": "1"', '"version": "2"'));
  f.put(f.source, "versions.toml", readFileSync(join(f.source, "versions.toml"), "utf8").replace('a = "1"', 'a = "2"'));
  f.commit(f.source); f.sync();
  assert.deepEqual(JSON.parse(readFileSync(join(f.dest, "package.json"))), { version: "2", name: "app", private: true, custom: true });
  assert.match(readFileSync(join(f.dest, "versions.toml"), "utf8"), /a = "2"/);
  assert.match(readFileSync(join(f.dest, "versions.toml"), "utf8"), /local = "custom"/);
});
