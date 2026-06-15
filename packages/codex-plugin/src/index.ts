import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";

export interface CodexPluginYaml {
  name: string;
  version: string;
  description: string;
  skills: string[];
}

export interface CodexSkillManifest {
  path: string;
  skillFile: string;
  title: string;
  agents: string[];
}

export interface CodexPluginManifest {
  schemaVersion: "stellar-agent.codex-plugin.v1";
  name: string;
  version: string;
  description: string;
  pluginRoot: string;
  skills: CodexSkillManifest[];
}

export interface CodexNativePluginJson {
  name: string;
  version: string;
  description: string;
  author: {
    name: string;
    url?: string;
  };
  homepage: string;
  repository: string;
  license: string;
  keywords: string[];
  skills: string;
  interface: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    developerName: string;
    category: string;
    capabilities: string[];
    websiteURL: string;
    defaultPrompt: string[];
    brandColor: string;
  };
}

export interface CodexPluginValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: CodexPluginManifest;
}

export async function validateCodexPlugin(pluginRoot: string): Promise<CodexPluginValidation> {
  const root = resolve(pluginRoot);
  const errors: string[] = [];
  const warnings: string[] = [];
  const pluginYaml = await readPluginYaml(root, errors);
  if (!pluginYaml) return { valid: false, errors, warnings };
  await validateNativePluginJson(root, pluginYaml, errors);

  const skills: CodexSkillManifest[] = [];
  for (const skillPath of pluginYaml.skills) {
    const fullSkillPath = resolve(root, skillPath);
    if (!isWithin(root, fullSkillPath)) {
      errors.push(`Skill path escapes plugin root: ${skillPath}`);
      continue;
    }
    const skillFile = join(fullSkillPath, "SKILL.md");
    const skillBody = await readOptional(skillFile);
    if (!skillBody?.trim()) {
      errors.push(`Missing or empty skill file: ${skillPath}/SKILL.md`);
      continue;
    }
    const agentsDir = join(fullSkillPath, "agents");
    const agents = await listYamlFiles(agentsDir);
    if (agents.length === 0) warnings.push(`No agent routing files found for skill: ${skillPath}`);
    for (const agent of agents) {
      const raw = await readOptional(join(agentsDir, agent));
      try {
        parse(raw ?? "");
      } catch (error) {
        errors.push(`Invalid YAML in ${skillPath}/agents/${agent}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    skills.push({
      path: normalizePath(skillPath),
      skillFile: normalizePath(relative(root, skillFile)),
      title: firstMarkdownHeading(skillBody) ?? skillPath.split("/").pop() ?? skillPath,
      agents: agents.map((agent) => normalizePath(join(skillPath, "agents", agent)))
    });
  }

  const manifest: CodexPluginManifest = {
    schemaVersion: "stellar-agent.codex-plugin.v1",
    name: pluginYaml.name,
    version: pluginYaml.version,
    description: pluginYaml.description,
    pluginRoot: root,
    skills
  };
  return { valid: errors.length === 0, errors, warnings, ...(errors.length === 0 ? { manifest } : {}) };
}

export async function writeCodexPluginManifest(pluginRoot: string, outputPath: string): Promise<CodexPluginManifest> {
  const validation = await validateCodexPlugin(pluginRoot);
  if (!validation.valid || !validation.manifest) {
    throw new Error(`Codex plugin is invalid: ${validation.errors.join("; ")}`);
  }
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(validation.manifest, null, 2)}\n`, { mode: 0o644 });
  return validation.manifest;
}

export async function writeCodexNativePluginJson(pluginRoot: string, outputPath = join(pluginRoot, ".codex-plugin", "plugin.json")): Promise<CodexNativePluginJson> {
  const root = resolve(pluginRoot);
  const errors: string[] = [];
  const pluginYaml = await readPluginYaml(root, errors);
  if (!pluginYaml) {
    throw new Error(`Codex plugin is invalid: ${errors.join("; ")}`);
  }
  const manifest = nativePluginJsonFromYaml(pluginYaml);
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

export function pluginYamlToString(plugin: CodexPluginYaml): string {
  return stringify(plugin);
}

export function nativePluginJsonFromYaml(plugin: CodexPluginYaml): CodexNativePluginJson {
  return {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    author: {
      name: "Stellar Agent Bridge maintainers",
      url: "https://github.com/someone-in-texas/Stellar-Agent"
    },
    homepage: "https://github.com/someone-in-texas/Stellar-Agent/tree/main/plugins/codex#readme",
    repository: "https://github.com/someone-in-texas/Stellar-Agent",
    license: "MIT",
    keywords: ["stellar", "payments", "testnet", "codex"],
    skills: "./skills/",
    interface: {
      displayName: "Stellar Agent Bridge",
      shortDescription: "Safe Stellar Agent Bridge workflows for Codex.",
      longDescription:
        "Codex skills for Testnet-first Stellar wallets, payments, receipts, guarded Mainnet workflows, DeFi preflight, and market-liquidity investigation.",
      developerName: "Stellar Agent Bridge maintainers",
      category: "Developer Tools",
      capabilities: ["Write", "Interactive"],
      websiteURL: "https://github.com/someone-in-texas/Stellar-Agent",
      defaultPrompt: [
        "Run a safe Stellar Testnet smoke test.",
        "Explain this payment policy before sending.",
        "Prepare a guarded Stellar payment workflow."
      ],
      brandColor: "#1D4ED8"
    }
  };
}

async function readPluginYaml(root: string, errors: string[]): Promise<CodexPluginYaml | undefined> {
  const pluginYamlPath = join(root, "plugin.yaml");
  const raw = await readOptional(pluginYamlPath);
  if (!raw) {
    errors.push("Missing plugin.yaml.");
    return undefined;
  }
  let parsed: any;
  try {
    parsed = parse(raw);
  } catch (error) {
    errors.push(`Invalid plugin.yaml: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    errors.push("plugin.yaml must be a YAML object.");
    return undefined;
  }
  const plugin = parsed as Partial<CodexPluginYaml>;
  if (!plugin.name || typeof plugin.name !== "string") errors.push("plugin.yaml must include string field: name.");
  if (!plugin.version || typeof plugin.version !== "string") errors.push("plugin.yaml must include string field: version.");
  if (!plugin.description || typeof plugin.description !== "string") {
    errors.push("plugin.yaml must include string field: description.");
  }
  if (!Array.isArray(plugin.skills) || plugin.skills.length === 0 || plugin.skills.some((skill) => typeof skill !== "string")) {
    errors.push("plugin.yaml must include a non-empty skills string array.");
  }
  if (errors.length > 0) return undefined;
  return plugin as CodexPluginYaml;
}

async function validateNativePluginJson(root: string, pluginYaml: CodexPluginYaml, errors: string[]): Promise<void> {
  const manifestPath = join(root, ".codex-plugin", "plugin.json");
  const raw = await readOptional(manifestPath);
  if (!raw) {
    errors.push("Missing .codex-plugin/plugin.json.");
    return;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    errors.push(`Invalid .codex-plugin/plugin.json: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push(".codex-plugin/plugin.json must be a JSON object.");
    return;
  }
  const manifest = parsed as Record<string, unknown>;
  for (const field of ["name", "version", "description", "skills"]) {
    if (typeof manifest[field] !== "string" || (manifest[field] as string).trim().length === 0) {
      errors.push(`.codex-plugin/plugin.json must include string field: ${field}.`);
    }
  }
  if (manifest.name !== pluginYaml.name) errors.push(".codex-plugin/plugin.json name must match plugin.yaml name.");
  if (manifest.version !== pluginYaml.version) errors.push(".codex-plugin/plugin.json version must match plugin.yaml version.");
  if (manifest.description !== pluginYaml.description) {
    errors.push(".codex-plugin/plugin.json description must match plugin.yaml description.");
  }
  if (typeof manifest.skills === "string" && normalizePath(manifest.skills).replace(/^\.\//, "").replace(/\/$/, "") !== "skills") {
    errors.push(".codex-plugin/plugin.json skills must point to ./skills/.");
  }
  if (manifest.hooks !== undefined) errors.push(".codex-plugin/plugin.json must not include unsupported hooks field.");
  if (manifest.apps !== undefined && !(await exists(join(root, ".app.json")))) {
    errors.push(".codex-plugin/plugin.json apps is present but .app.json is missing.");
  }
  if (manifest.mcpServers !== undefined && !(await exists(join(root, ".mcp.json")))) {
    errors.push(".codex-plugin/plugin.json mcpServers is present but .mcp.json is missing.");
  }
  const author = manifest.author;
  if (!author || typeof author !== "object" || Array.isArray(author) || typeof (author as Record<string, unknown>).name !== "string") {
    errors.push(".codex-plugin/plugin.json must include author.name.");
  }
  const interfaceMetadata = manifest.interface;
  if (!interfaceMetadata || typeof interfaceMetadata !== "object" || Array.isArray(interfaceMetadata)) {
    errors.push(".codex-plugin/plugin.json must include interface metadata.");
    return;
  }
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    if (typeof (interfaceMetadata as Record<string, unknown>)[field] !== "string") {
      errors.push(`.codex-plugin/plugin.json must include interface.${field}.`);
    }
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function listYamlFiles(path: string): Promise<string[]> {
  try {
    await access(path);
    return (await readdir(path)).filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml")).sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function firstMarkdownHeading(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function isWithin(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}
