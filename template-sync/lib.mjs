import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const STATE_PATH = ".github/template-sync-state.json";
export const CONFIG_PATH = ".github/template-sync.yml";

const TOKEN_NAMES = [
  "owner",
  "owner_lower",
  "owner_slug",
  "kebab",
  "pascal",
  "camel",
  "display",
  "slug",
];
const TOKEN_RE = /\{(owner|owner_lower|owner_slug|kebab|pascal|camel|display|slug)\}/g;
const TOML_TABLE_RE = /^\[([^\]]+)]\s*$/gm;
const TOML_KEY_RE = /^([A-Za-z0-9_-]+)\s*=/;

/** Shared GitHub/org files. Stack-specific paths belong in each template's config. */
export const DEFAULT_OVERWRITE = [
  ".editorconfig",
  ".github/renovate.json5",
  ".github/ISSUE_TEMPLATE/**",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
];

export const DEFAULT_THREE_WAY = ["AGENTS.md", ".github/template-sync.yml"];

export const DEFAULT_EXCLUDE = [".github/template-sync-state.json", "README.md"];

export const DEFAULT_OWNER_FILES = ["README.md", "CONTRIBUTING.md"];

export function defaultConfig() {
  return {
    source: "",
    source_ref: "",
    prefer_branch: "dev",
    overwrite: [...DEFAULT_OVERWRITE],
    merge_toml: [],
    merge_json: [],
    three_way: [...DEFAULT_THREE_WAY],
    exclude: [...DEFAULT_EXCLUDE],
    identity: {
      extra: {},
      owner_files: [...DEFAULT_OWNER_FILES],
    },
  };
}

export function isBinary(data) {
  return Buffer.isBuffer(data) && data.includes(0);
}

export function pathMatches(path, pattern) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const glob = pattern.replaceAll("\\", "/");
  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3).replace(/\/$/, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  return globMatch(normalized, glob) || globMatch(basename(normalized), glob);
}

function globMatch(value, pattern) {
  let regex = "^";
  for (const char of pattern) {
    if (char === "*") regex += ".*";
    else if (char === "?") regex += ".";
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  regex += "$";
  return new RegExp(regex).test(value);
}

function stripInlineComment(rawLine) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < rawLine.length; i += 1) {
    const char = rawLine[i];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === "#" && !inSingle && !inDouble) {
      return rawLine.slice(0, i).replace(/[ \t]+$/, "");
    }
  }
  return rawLine.replace(/[ \t]+$/, "");
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceScalar(raw) {
  const value = unquote(raw);
  const lowered = value.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

function parseMap(entries, index, indent) {
  const map = {};
  while (index < entries.length && entries[index].indent === indent && !entries[index].text.startsWith("- ")) {
    const line = entries[index].text;
    if (!line.includes(":")) {
      throw new Error(`unsupported yaml line: ${line}`);
    }
    const colon = line.indexOf(":");
    const key = unquote(line.slice(0, colon).trim());
    const rest = line.slice(colon + 1).trim();
    index += 1;
    if (rest !== "") {
      map[key] = coerceScalar(rest);
      continue;
    }
    if (index < entries.length && entries[index].indent > indent) {
      const nested = parseBlock(entries, index, entries[index].indent);
      map[key] = nested.value;
      index = nested.next;
    } else {
      map[key] = [];
    }
  }
  return { value: map, next: index };
}

function parseList(entries, index, indent) {
  const list = [];
  while (index < entries.length && entries[index].indent === indent && entries[index].text.startsWith("- ")) {
    const item = entries[index].text.replace(/^- /, "").trim();
    index += 1;
    if (item === "" && index < entries.length && entries[index].indent > indent) {
      const nested = parseBlock(entries, index, entries[index].indent);
      list.push(nested.value);
      index = nested.next;
    } else {
      list.push(coerceScalar(item));
    }
  }
  return { value: list, next: index };
}

function parseBlock(entries, index, indent) {
  if (index >= entries.length) return { value: {}, next: index };
  if (entries[index].text.startsWith("- ")) return parseList(entries, index, indent);
  return parseMap(entries, index, indent);
}

export function parseSimpleYaml(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine);
    if (!line.trim()) continue;
    entries.push({ indent: line.match(/^ */)[0].length, text: line.trim() });
  }
  if (entries.length === 0) return {};
  const parsed = parseBlock(entries, 0, entries[0].indent);
  return parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value : {};
}

export function loadConfig(root, { readFile = readFileSync } = {}) {
  const config = defaultConfig();
  let text;
  try {
    text = readFile(join(root, CONFIG_PATH), "utf8");
  } catch {
    return config;
  }

  const parsed = parseSimpleYaml(text);
  for (const field of [
    "source",
    "source_ref",
    "prefer_branch",
    "overwrite",
    "merge_toml",
    "merge_json",
    "three_way",
    "exclude",
  ]) {
    if (!(field in parsed)) continue;
    let value = parsed[field];
    if ((field === "source" || field === "source_ref") && Array.isArray(value) && value.length === 0) {
      value = "";
    }
    config[field] = value;
  }
  if (parsed.identity && typeof parsed.identity === "object" && !Array.isArray(parsed.identity)) {
    if (parsed.identity.extra && typeof parsed.identity.extra === "object" && !Array.isArray(parsed.identity.extra)) {
      config.identity.extra = parsed.identity.extra;
    }
    if (Array.isArray(parsed.identity.owner_files)) {
      config.identity.owner_files = parsed.identity.owner_files;
    }
  }
  return config;
}

export function pascalToCamel(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

export function pascalToDisplay(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function kebabToPascal(value) {
  return value
    .replace(/(^|[-_])([A-Za-z0-9])/g, (_all, _sep, char) => char.toUpperCase())
    .replaceAll(/[-_]/g, "");
}

export function identityFromRepo(owner, repoName) {
  const pascal = kebabToPascal(repoName);
  return {
    owner,
    owner_lower: owner.toLowerCase(),
    owner_slug: owner.toLowerCase().replaceAll(/[^a-z0-9]/g, ""),
    kebab: repoName,
    pascal,
    camel: pascalToCamel(pascal),
    display: pascalToDisplay(pascal),
    slug: repoName.toLowerCase().replaceAll(/[^a-z0-9]/g, ""),
  };
}

export function interpolate(template, identity) {
  return template.replace(TOKEN_RE, (_all, name) => identity[name] ?? "");
}

export function replacementPairs(source, dest, extra = {}) {
  const pairs = [];
  for (const [find, replace] of Object.entries(extra)) {
    pairs.push([String(find), interpolate(String(replace), dest)]);
  }
  pairs.push(
    [source.kebab, dest.kebab],
    [source.display, dest.kebab],
    [source.pascal, dest.pascal],
    [source.camel, dest.camel],
    [source.slug, dest.slug],
  );
  pairs.sort((left, right) => right[0].length - left[0].length || left[0].localeCompare(right[0]));
  return pairs.filter(([oldValue, newValue]) => oldValue && oldValue !== newValue);
}

function shouldReplaceOwner(relPath, config) {
  return (config.identity?.owner_files ?? DEFAULT_OWNER_FILES).some((pattern) => pathMatches(relPath, pattern));
}

export function substitute(text, source, dest, relPath, config = defaultConfig()) {
  let pairs = replacementPairs(source, dest, config.identity?.extra);
  if (shouldReplaceOwner(relPath, config) && source.owner !== dest.owner) {
    pairs = [...pairs, [source.owner, dest.owner]];
    pairs.sort((left, right) => right[0].length - left[0].length || left[0].localeCompare(right[0]));
  }
  for (const [oldValue, newValue] of pairs) {
    text = text.split(oldValue).join(newValue);
  }
  return text;
}

export function mapPath(relPath, source, dest, config = defaultConfig()) {
  return substitute(relPath, source, dest, relPath, config);
}

export function classifyFile(relPath, config) {
  // GITHUB_TOKEN cannot create or update files under .github/workflows/.
  if (pathMatches(relPath, ".github/workflows/**")) return null;
  if (config.exclude.some((pattern) => pathMatches(relPath, pattern))) return null;
  if ((config.merge_toml ?? []).some((pattern) => pathMatches(relPath, pattern))) return "merge_toml";
  if ((config.merge_json ?? []).some((pattern) => pathMatches(relPath, pattern))) return "merge_json";
  if (config.three_way.some((pattern) => pathMatches(relPath, pattern))) return "three_way";
  if (config.overwrite.some((pattern) => pathMatches(relPath, pattern))) return "overwrite";
  return null;
}

function splitTomlSections(text) {
  const matches = [...text.matchAll(TOML_TABLE_RE)];
  if (matches.length === 0) return { preamble: text, sections: [] };
  const preamble = text.slice(0, matches[0].index);
  const sections = matches.map((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    return { name: match[1], body: text.slice(match.index, end) };
  });
  return { preamble, sections };
}

function tomlKeyLines(sectionBody) {
  const keys = {};
  for (const line of sectionBody.split(/\r?\n/).slice(1)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const match = TOML_KEY_RE.exec(stripped);
    if (match) keys[match[1]] = line;
  }
  return keys;
}

export function mergeToml(templateText, destText) {
  if (!destText.trim()) return templateText.endsWith("\n") ? templateText : `${templateText}\n`;

  const template = splitTomlSections(templateText);
  const dest = splitTomlSections(destText);
  const destMap = Object.fromEntries(dest.sections.map((section) => [section.name, section.body]));
  const templateMap = Object.fromEntries(template.sections.map((section) => [section.name, section.body]));

  const orderedNames = [];
  for (const section of dest.sections) {
    if (!orderedNames.includes(section.name)) orderedNames.push(section.name);
  }
  for (const section of template.sections) {
    if (!orderedNames.includes(section.name)) orderedNames.push(section.name);
  }

  const output = dest.preamble ? [dest.preamble] : [];
  for (const name of orderedNames) {
    const destBody = destMap[name];
    const templateBody = templateMap[name];
    if (destBody == null && templateBody != null) {
      output.push(templateBody.endsWith("\n") ? templateBody : `${templateBody}\n`);
      continue;
    }
    if (templateBody == null) {
      output.push(destBody.endsWith("\n") ? destBody : `${destBody}\n`);
      continue;
    }

    const templateKeys = tomlKeyLines(templateBody);
    const newLines = [];
    const replaced = new Set();
    for (const line of destBody.split(/\r?\n/)) {
      const stripped = line.trim();
      const match = stripped && !stripped.startsWith("#") ? TOML_KEY_RE.exec(stripped) : null;
      const key = match?.[1];
      if (key && key in templateKeys) {
        newLines.push(templateKeys[key]);
        replaced.add(key);
      } else {
        newLines.push(line);
      }
    }

    const missing = Object.keys(templateKeys).filter((key) => !replaced.has(key));
    if (missing.length > 0) {
      let insertAt = newLines.length;
      while (insertAt > 0 && !newLines[insertAt - 1].trim()) insertAt -= 1;
      for (const key of missing) {
        newLines.splice(insertAt, 0, templateKeys[key]);
        insertAt += 1;
      }
    }

    const body = newLines.join("\n");
    output.push(body.endsWith("\n") ? body : `${body}\n`);
  }

  let merged = output.join("");
  if (!merged.endsWith("\n")) merged += "\n";
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMergeJson(dest, template) {
  if (isPlainObject(dest) && isPlainObject(template)) {
    const output = { ...dest };
    for (const key of Object.keys(template)) {
      output[key] = key in dest ? deepMergeJson(dest[key], template[key]) : template[key];
    }
    return output;
  }
  return template;
}

function detectJsonIndent(text) {
  const match = text.match(/\n( +)"/);
  return match ? match[1].length : 2;
}

export function mergeJson(templateText, destText) {
  const incoming = JSON.parse(templateText);
  if (!destText.trim()) {
    return `${JSON.stringify(incoming, null, 2)}\n`;
  }
  const dest = JSON.parse(destText);
  const merged = deepMergeJson(dest, incoming);
  return `${JSON.stringify(merged, null, detectJsonIndent(destText))}\n`;
}

export function threeWayMerge(ancestor, dest, incoming) {
  const dir = mkdtempSync(join(tmpdir(), "template-sync-"));
  try {
    const destFile = join(dir, "dest");
    const ancestorFile = join(dir, "ancestor");
    const incomingFile = join(dir, "incoming");
    writeFileSync(destFile, dest);
    writeFileSync(ancestorFile, ancestor);
    writeFileSync(incomingFile, incoming);
    try {
      const stdout = execFileSync(
        "git",
        ["merge-file", "-p", "-L", "dest", "-L", "ancestor", "-L", "template", destFile, ancestorFile, incomingFile],
        { encoding: "utf8" },
      );
      return { text: stdout, conflict: false };
    } catch (error) {
      if (error.status > 0 && typeof error.stdout === "string") {
        return { text: error.stdout, conflict: true };
      }
      throw error;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export { TOKEN_NAMES };
