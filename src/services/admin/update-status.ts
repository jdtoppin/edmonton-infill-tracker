import { z } from "zod";

export const UPDATE_REPOSITORY = "jdtoppin/edmonton-infill-tracker";
export const UPDATE_CHECK_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/commits/main`;
const githubWebRepositoryUrl = `https://github.com/${UPDATE_REPOSITORY}`;
const maximumResponseBytes = 256 * 1_024;
const defaultTimeoutMs = 5_000;
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);

const githubCommitSchema = z
  .object({
    sha: shaSchema,
    commit: z
      .object({
        message: z.string().min(1).max(200_000),
        committer: z
          .object({
            date: z.string().datetime({ offset: true }),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type ApplicationUpdateStatus =
  | {
      state: "up-to-date" | "update-available" | "build-unknown";
      checkedAt: string;
      currentBuildSha: string | null;
      latestBuildSha: string;
      latestCommitUrl: string;
      latestCommittedAt: string;
      summary: string;
    }
  | {
      state: "unavailable";
      checkedAt: string;
      currentBuildSha: string | null;
      reason: "network" | "upstream" | "invalid-response";
    };

function normalizedBuildSha(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && shaSchema.safeParse(normalized).success ? normalized : null;
}

function commitSummary(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? "";
  return firstLine
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 160);
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new Error("invalid-content-type");
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumResponseBytes
    ) {
      throw new Error("invalid-content-length");
    }
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
    throw new Error("response-too-large");
  }
  return JSON.parse(text) as unknown;
}

/**
 * Checks one hard-coded public GitHub endpoint. It does not accept credentials,
 * repository names, commands, paths, Docker access, or an update target.
 */
export async function checkApplicationUpdate(
  options: {
    fetchImpl?: typeof fetch;
    currentBuildSha?: string;
    timeoutMs?: number;
    now?: Date;
  } = {},
): Promise<ApplicationUpdateStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const checkedAt = options.now ?? new Date();
  if (Number.isNaN(checkedAt.getTime())) throw new Error("Update-check time must be valid.");
  const currentBuildSha = normalizedBuildSha(options.currentBuildSha ?? process.env.APP_BUILD_SHA);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) {
    throw new Error("Update-check timeout must be between 250 and 30000 milliseconds.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(UPDATE_CHECK_URL, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "edmonton-infill-tracker-update-check",
        "x-github-api-version": "2026-03-10",
      },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return {
      state: "unavailable",
      checkedAt: checkedAt.toISOString(),
      currentBuildSha,
      reason: "network",
    };
  }
  if (!response.ok) {
    clearTimeout(timer);
    return {
      state: "unavailable",
      checkedAt: checkedAt.toISOString(),
      currentBuildSha,
      reason: "upstream",
    };
  }

  try {
    const parsed = githubCommitSchema.parse(await boundedJson(response));
    clearTimeout(timer);
    const latestBuildSha = parsed.sha;
    const state = currentBuildSha
      ? currentBuildSha === latestBuildSha
        ? "up-to-date"
        : "update-available"
      : "build-unknown";
    return {
      state,
      checkedAt: checkedAt.toISOString(),
      currentBuildSha,
      latestBuildSha,
      latestCommitUrl: `${githubWebRepositoryUrl}/commit/${latestBuildSha}`,
      latestCommittedAt: parsed.commit.committer.date,
      summary: commitSummary(parsed.commit.message),
    };
  } catch {
    clearTimeout(timer);
    return {
      state: "unavailable",
      checkedAt: checkedAt.toISOString(),
      currentBuildSha,
      reason: "invalid-response",
    };
  }
}
