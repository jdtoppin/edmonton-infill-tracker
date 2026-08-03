#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumResponseBytes = 2 * 1024 * 1024;
const requestTimeoutMs = 15_000;

const componentDefinitions = {
  node: {
    label: "Node.js",
    source: "docker",
    repository: "node",
    suffix: "bookworm-slim",
    versionParts: 3,
  },
  npm: {
    label: "npm",
    source: "npm",
    versionParts: 3,
  },
  npmBraceExpansion: {
    label: "npm bundled brace-expansion",
    source: "npm-package",
    packageName: "brace-expansion",
    versionParts: 3,
  },
  caddyGo: {
    label: "Caddy Go toolchain",
    source: "docker",
    repository: "golang",
    suffix: "alpine3.24",
    versionParts: 3,
  },
  caddy: {
    label: "Caddy",
    source: "docker",
    repository: "caddy",
    suffix: "alpine",
    versionParts: 3,
  },
  caddyXText: {
    label: "Caddy golang.org/x/text",
    source: "go-module",
    packageName: "golang.org/x/text",
    versionParts: 3,
  },
  caddyGrpc: {
    label: "Caddy google.golang.org/grpc",
    source: "go-module",
    packageName: "google.golang.org/grpc",
    versionParts: 3,
  },
  postgres: {
    label: "PostgreSQL",
    source: "docker",
    repository: "postgres",
    suffix: "bookworm",
    versionParts: 2,
  },
};

function parseVersion(value, expectedParts) {
  const parts = value.split(".");
  if (parts.length !== expectedParts || parts.some((part) => !/^\d+$/.test(part))) return null;
  const parsed = parts.map(Number);
  return parsed.every(Number.isSafeInteger) ? parsed : null;
}

function compareVersions(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectLatestIncrementalVersion({ current, tags, suffix, versionParts }) {
  const currentParts = parseVersion(current, versionParts);
  if (!currentParts) throw new Error(`Invalid pinned version: ${current}`);

  const tagPattern = new RegExp(`^(\\d+(?:\\.\\d+){${versionParts - 1}})-${suffix}$`);
  const candidates = tags
    .map((tag) => tagPattern.exec(tag)?.[1] ?? null)
    .filter((version) => version !== null)
    .map((version) => ({ version, parts: parseVersion(version, versionParts) }))
    .filter((candidate) => candidate.parts?.[0] === currentParts[0])
    .sort((left, right) => compareVersions(right.parts, left.parts));

  const newest = candidates[0];
  return newest && compareVersions(newest.parts, currentParts) > 0 ? newest.version : current;
}

export function selectLatestSameMajorVersion({ current, candidate, versionParts }) {
  const currentParts = parseVersion(current, versionParts);
  const candidateParts = parseVersion(candidate, versionParts);
  if (!currentParts) throw new Error(`Invalid pinned version: ${current}`);
  if (!candidateParts || candidateParts[0] !== currentParts[0]) {
    throw new Error(`Invalid same-major update candidate: ${candidate}`);
  }
  return compareVersions(candidateParts, currentParts) > 0 ? candidate : current;
}

export function selectLatestSameMajorFromVersions({ current, versions, versionParts }) {
  const currentParts = parseVersion(current, versionParts);
  if (!currentParts) throw new Error(`Invalid pinned version: ${current}`);

  const candidates = versions
    .map((version) => ({ version, parts: parseVersion(version, versionParts) }))
    .filter((candidate) => candidate.parts?.[0] === currentParts[0])
    .sort((left, right) => compareVersions(right.parts, left.parts));
  const newest = candidates[0];
  return newest && compareVersions(newest.parts, currentParts) > 0 ? newest.version : current;
}

function exactlyOneMatch(contents, pattern, label) {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error(`${label} must contain exactly one recognizable version pin.`);
  }
  return matches[0][1];
}

async function readRepositoryFile(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

export async function readPinnedVersions() {
  const [dockerfile, caddyDockerfile, postgresDockerfile] = await Promise.all([
    readRepositoryFile("Dockerfile"),
    readRepositoryFile("deploy/caddy/Dockerfile"),
    readRepositoryFile("deploy/postgis/Dockerfile"),
  ]);

  return {
    node: exactlyOneMatch(dockerfile, /^ARG NODE_VERSION=(\d+\.\d+\.\d+)$/gm, "Dockerfile"),
    npm: exactlyOneMatch(dockerfile, /^ARG NPM_VERSION=(\d+\.\d+\.\d+)$/gm, "Dockerfile"),
    npmBraceExpansion: exactlyOneMatch(
      dockerfile,
      /^ARG NPM_BRACE_EXPANSION_VERSION=(\d+\.\d+\.\d+)$/gm,
      "Dockerfile",
    ),
    caddyGo: exactlyOneMatch(
      caddyDockerfile,
      /^ARG CADDY_GO_VERSION=(\d+\.\d+\.\d+)$/gm,
      "deploy/caddy/Dockerfile",
    ),
    caddy: exactlyOneMatch(
      caddyDockerfile,
      /^ARG CADDY_VERSION=(\d+\.\d+\.\d+)$/gm,
      "deploy/caddy/Dockerfile",
    ),
    caddyXText: exactlyOneMatch(
      caddyDockerfile,
      /^ARG CADDY_X_TEXT_VERSION=(\d+\.\d+\.\d+)$/gm,
      "deploy/caddy/Dockerfile",
    ),
    caddyGrpc: exactlyOneMatch(
      caddyDockerfile,
      /^ARG CADDY_GRPC_VERSION=(\d+\.\d+\.\d+)$/gm,
      "deploy/caddy/Dockerfile",
    ),
    postgres: exactlyOneMatch(
      postgresDockerfile,
      /^FROM postgres:(\d+\.\d+)-bookworm$/gm,
      "deploy/postgis/Dockerfile",
    ),
  };
}

async function fetchDockerTags(repository, major, fetchImpl = fetch) {
  const tags = [];
  let nextUrl =
    `https://hub.docker.com/v2/repositories/library/${repository}/tags` +
    `?page_size=100&name=${encodeURIComponent(`${major}.`)}`;

  for (let page = 0; nextUrl && page < 5; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(nextUrl, {
        headers: { accept: "application/json", "user-agent": "edmonton-infill-support-updater" },
        redirect: "error",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Docker Hub returned HTTP ${response.status}.`);

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
      throw new Error("Docker Hub response exceeded the size limit.");
    }
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.results)) {
      throw new Error("Docker Hub returned an invalid tag response.");
    }
    for (const result of parsed.results) {
      if (!result || typeof result.name !== "string" || !Array.isArray(result.images)) continue;
      const architectures = new Set(
        result.images
          .map((image) =>
            image && typeof image.architecture === "string" ? image.architecture : "",
          )
          .filter(Boolean),
      );
      if (architectures.has("amd64") && architectures.has("arm64")) tags.push(result.name);
    }
    nextUrl =
      typeof parsed.next === "string" && parsed.next.startsWith("https://hub.docker.com/")
        ? parsed.next
        : null;
  }
  if (tags.length === 0) {
    throw new Error(`Docker Hub returned no amd64/arm64 tags for library/${repository}.`);
  }
  return tags;
}

async function fetchNpmSameMajorVersion(major, fetchImpl = fetch) {
  const parsed = await fetchNpmDistTags("npm", fetchImpl);
  const candidate = parsed?.[`next-${major}`];
  if (typeof candidate !== "string" || !/^\d+\.\d+\.\d+$/.test(candidate)) {
    throw new Error(`npm registry returned no stable npm ${major} release tag.`);
  }
  return candidate;
}

async function fetchNpmDistTags(packageName, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetchImpl(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`,
      {
        headers: { accept: "application/json", "user-agent": "edmonton-infill-support-updater" },
        redirect: "error",
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}.`);

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
    throw new Error("npm registry response exceeded the size limit.");
  }
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("npm registry returned an invalid dist-tag response.");
  }
  return parsed;
}

async function fetchNpmPackageVersions(packageName, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
      headers: {
        accept: "application/vnd.npm.install-v1+json",
        "user-agent": "edmonton-infill-support-updater",
      },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}.`);

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
    throw new Error("npm registry response exceeded the size limit.");
  }
  const parsed = JSON.parse(body);
  if (!parsed?.versions || typeof parsed.versions !== "object" || Array.isArray(parsed.versions)) {
    throw new Error(`npm registry returned invalid ${packageName} version metadata.`);
  }
  const versions = Object.keys(parsed.versions);
  if (versions.length === 0) {
    throw new Error(`npm registry returned no published ${packageName} versions.`);
  }
  return versions;
}

async function fetchGoModuleVersions(packageName, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const modulePath = packageName.split("/").map(encodeURIComponent).join("/");
  let response;
  try {
    response = await fetchImpl(`https://proxy.golang.org/${modulePath}/@v/list`, {
      headers: { accept: "text/plain", "user-agent": "edmonton-infill-support-updater" },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Go module proxy returned HTTP ${response.status}.`);

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
    throw new Error("Go module proxy response exceeded the size limit.");
  }
  const versions = body
    .split(/\r?\n/)
    .map((version) => (/^v\d+\.\d+\.\d+$/.test(version) ? version.slice(1) : null))
    .filter((version) => version !== null);
  if (versions.length === 0) {
    throw new Error(`Go module proxy returned no stable ${packageName} versions.`);
  }
  return versions;
}

export async function discoverIncrementalUpdates(currentVersions, fetchImpl = fetch) {
  const entries = await Promise.all(
    Object.entries(componentDefinitions).map(async ([key, definition]) => {
      const current = currentVersions[key];
      const currentParts = parseVersion(current, definition.versionParts);
      if (!currentParts) throw new Error(`Invalid ${definition.label} pin: ${current}`);
      const latest =
        definition.source === "npm"
          ? selectLatestSameMajorVersion({
              current,
              candidate: await fetchNpmSameMajorVersion(currentParts[0], fetchImpl),
              versionParts: definition.versionParts,
            })
          : definition.source === "npm-package"
            ? selectLatestSameMajorFromVersions({
                current,
                versions: await fetchNpmPackageVersions(definition.packageName, fetchImpl),
                versionParts: definition.versionParts,
              })
            : definition.source === "go-module"
              ? selectLatestSameMajorFromVersions({
                  current,
                  versions: await fetchGoModuleVersions(definition.packageName, fetchImpl),
                  versionParts: definition.versionParts,
                })
              : selectLatestIncrementalVersion({
                  current,
                  tags: await fetchDockerTags(definition.repository, currentParts[0], fetchImpl),
                  suffix: definition.suffix,
                  versionParts: definition.versionParts,
                });
      return [key, { ...definition, current, latest }];
    }),
  );
  return Object.fromEntries(entries);
}

function replaceExpected(contents, search, replacement, expectedCount, label) {
  const count = contents.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label} expected ${expectedCount} occurrence(s), found ${count}.`);
  }
  return contents.split(search).join(replacement);
}

async function updateFile(relativePath, replacements) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  let contents = await readFile(absolutePath, "utf8");
  const original = contents;
  for (const replacement of replacements) {
    contents = replaceExpected(contents, ...replacement, relativePath);
  }
  if (contents !== original) await writeFile(absolutePath, contents, "utf8");
}

export async function applyPinnedVersions(current, latest) {
  const nodeReplacement = [current.node, latest.node];
  const npmReplacement = [current.npm, latest.npm];
  const npmBraceExpansionReplacement = [current.npmBraceExpansion, latest.npmBraceExpansion];
  const caddyGoReplacement = [current.caddyGo, latest.caddyGo];
  const caddyReplacement = [current.caddy, latest.caddy];
  const caddyXTextReplacement = [current.caddyXText, latest.caddyXText];
  const caddyGrpcReplacement = [current.caddyGrpc, latest.caddyGrpc];
  const postgresImageReplacement = [`${current.postgres}-3`, `${latest.postgres}-3`];

  await Promise.all([
    updateFile("Dockerfile", [
      [`ARG NODE_VERSION=${nodeReplacement[0]}`, `ARG NODE_VERSION=${nodeReplacement[1]}`, 1],
      [`ARG NPM_VERSION=${npmReplacement[0]}`, `ARG NPM_VERSION=${npmReplacement[1]}`, 1],
      [
        `ARG NPM_BRACE_EXPANSION_VERSION=${npmBraceExpansionReplacement[0]}`,
        `ARG NPM_BRACE_EXPANSION_VERSION=${npmBraceExpansionReplacement[1]}`,
        1,
      ],
    ]),
    updateFile("docker-compose.yml", [
      [
        `NODE_VERSION: \${NODE_VERSION:-${nodeReplacement[0]}}`,
        `NODE_VERSION: \${NODE_VERSION:-${nodeReplacement[1]}}`,
        1,
      ],
      [
        `NPM_VERSION: \${NPM_VERSION:-${npmReplacement[0]}}`,
        `NPM_VERSION: \${NPM_VERSION:-${npmReplacement[1]}}`,
        1,
      ],
      [
        `edmonton-infill-postgis:\${POSTGIS_IMAGE_TAG:-${postgresImageReplacement[0]}}`,
        `edmonton-infill-postgis:\${POSTGIS_IMAGE_TAG:-${postgresImageReplacement[1]}}`,
        1,
      ],
      [
        `CADDY_GO_VERSION: \${CADDY_GO_VERSION:-${caddyGoReplacement[0]}}`,
        `CADDY_GO_VERSION: \${CADDY_GO_VERSION:-${caddyGoReplacement[1]}}`,
        1,
      ],
      [
        `CADDY_VERSION: \${CADDY_VERSION:-${caddyReplacement[0]}}`,
        `CADDY_VERSION: \${CADDY_VERSION:-${caddyReplacement[1]}}`,
        1,
      ],
      [
        `CADDY_X_TEXT_VERSION: \${CADDY_X_TEXT_VERSION:-${caddyXTextReplacement[0]}}`,
        `CADDY_X_TEXT_VERSION: \${CADDY_X_TEXT_VERSION:-${caddyXTextReplacement[1]}}`,
        1,
      ],
      [
        `CADDY_GRPC_VERSION: \${CADDY_GRPC_VERSION:-${caddyGrpcReplacement[0]}}`,
        `CADDY_GRPC_VERSION: \${CADDY_GRPC_VERSION:-${caddyGrpcReplacement[1]}}`,
        1,
      ],
    ]),
    updateFile("docker-compose.dev.yml", [
      [
        `NODE_VERSION: \${NODE_VERSION:-${nodeReplacement[0]}}`,
        `NODE_VERSION: \${NODE_VERSION:-${nodeReplacement[1]}}`,
        1,
      ],
      [
        `NPM_VERSION: \${NPM_VERSION:-${npmReplacement[0]}}`,
        `NPM_VERSION: \${NPM_VERSION:-${npmReplacement[1]}}`,
        1,
      ],
      [
        `edmonton-infill-postgis:\${POSTGIS_IMAGE_TAG:-${postgresImageReplacement[0]}}`,
        `edmonton-infill-postgis:\${POSTGIS_IMAGE_TAG:-${postgresImageReplacement[1]}}`,
        1,
      ],
    ]),
    updateFile("deploy/postgis/Dockerfile", [
      [
        `FROM postgres:${current.postgres}-bookworm`,
        `FROM postgres:${latest.postgres}-bookworm`,
        1,
      ],
    ]),
    updateFile("deploy/caddy/Dockerfile", [
      [
        `ARG CADDY_GO_VERSION=${caddyGoReplacement[0]}`,
        `ARG CADDY_GO_VERSION=${caddyGoReplacement[1]}`,
        1,
      ],
      [`ARG CADDY_VERSION=${caddyReplacement[0]}`, `ARG CADDY_VERSION=${caddyReplacement[1]}`, 1],
      [
        `ARG CADDY_X_TEXT_VERSION=${caddyXTextReplacement[0]}`,
        `ARG CADDY_X_TEXT_VERSION=${caddyXTextReplacement[1]}`,
        1,
      ],
      [
        `ARG CADDY_GRPC_VERSION=${caddyGrpcReplacement[0]}`,
        `ARG CADDY_GRPC_VERSION=${caddyGrpcReplacement[1]}`,
        1,
      ],
    ]),
    updateFile(".github/workflows/ci.yml", [
      [`node-version: ${current.node}`, `node-version: ${latest.node}`, 5],
    ]),
    updateFile(".github/workflows/support-component-updates.yml", [
      [`node-version: ${current.node}`, `node-version: ${latest.node}`, 1],
    ]),
  ]);
}

async function writeGitHubOutputs(updates, changed) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const changedComponents = Object.values(updates)
    .filter((update) => update.current !== update.latest)
    .map((update) => `${update.label} ${update.current} -> ${update.latest}`);
  const lines = [
    `changed=${changed ? "true" : "false"}`,
    `summary=${changedComponents.join("; ") || "No incremental support-component updates found"}`,
  ];
  for (const [key, update] of Object.entries(updates)) lines.push(`${key}=${update.latest}`);
  await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--apply");
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument: ${unknownArguments[0]}`);
  }

  const current = await readPinnedVersions();
  const updates = await discoverIncrementalUpdates(current);
  const latest = Object.fromEntries(
    Object.entries(updates).map(([key, update]) => [key, update.latest]),
  );
  const changed = Object.values(updates).some((update) => update.current !== update.latest);

  if (apply && changed) await applyPinnedVersions(current, latest);
  await writeGitHubOutputs(updates, changed);

  for (const update of Object.values(updates)) {
    const marker = update.current === update.latest ? "current" : apply ? "updated" : "available";
    console.log(`${update.label}: ${update.current} -> ${update.latest} (${marker})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
