import { describe, expect, it, vi } from "vitest";

import {
  checkApplicationUpdate,
  UPDATE_CHECK_URL,
  UPDATE_REPOSITORY,
} from "../../src/services/admin/update-status";

const currentSha = "1".repeat(40);
const latestSha = "a".repeat(40);

function githubResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      sha: latestSha,
      commit: {
        message: "feat: ship the next release\n\nDetails",
        committer: {
          name: "GitHub",
          email: "noreply@github.com",
          date: "2026-08-02T18:00:00Z",
        },
      },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

describe("safe application update status", () => {
  it("checks only the pinned public main endpoint without credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(githubResponse());
    const result = await checkApplicationUpdate({
      fetchImpl,
      currentBuildSha: currentSha,
      now: new Date("2026-08-02T19:00:00.000Z"),
    });

    expect(UPDATE_REPOSITORY).toBe("jdtoppin/edmonton-infill-tracker");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(UPDATE_CHECK_URL);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|token|secret/i);
    expect(result).toEqual({
      state: "update-available",
      checkedAt: "2026-08-02T19:00:00.000Z",
      currentBuildSha: currentSha,
      latestBuildSha: latestSha,
      latestCommitUrl: `https://github.com/jdtoppin/edmonton-infill-tracker/commit/${latestSha}`,
      latestCommittedAt: "2026-08-02T18:00:00Z",
      summary: "feat: ship the next release",
    });
  });

  it("recognizes the deployed build and handles an absent compiled SHA honestly", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(githubResponse());
    await expect(
      checkApplicationUpdate({ fetchImpl, currentBuildSha: latestSha }),
    ).resolves.toMatchObject({ state: "up-to-date", currentBuildSha: latestSha });
    await expect(
      checkApplicationUpdate({
        fetchImpl: vi.fn().mockResolvedValue(githubResponse()),
        currentBuildSha: "development",
      }),
    ).resolves.toMatchObject({ state: "build-unknown", currentBuildSha: null });
  });

  it("returns a generic unavailable state for malformed or oversized responses", async () => {
    await expect(
      checkApplicationUpdate({
        fetchImpl: vi.fn().mockResolvedValue(githubResponse({ sha: "not-a-sha" })),
        currentBuildSha: currentSha,
      }),
    ).resolves.toMatchObject({ state: "unavailable", reason: "invalid-response" });

    const oversized = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "999999" },
    });
    await expect(
      checkApplicationUpdate({
        fetchImpl: vi.fn().mockResolvedValue(oversized),
        currentBuildSha: currentSha,
      }),
    ).resolves.toMatchObject({ state: "unavailable", reason: "invalid-response" });
  });

  it("does not expose network or upstream response details", async () => {
    await expect(
      checkApplicationUpdate({
        fetchImpl: vi.fn().mockRejectedValue(new Error("secret network detail")),
        currentBuildSha: currentSha,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "unavailable",
        currentBuildSha: currentSha,
        reason: "network",
      }),
    );
    await expect(
      checkApplicationUpdate({
        fetchImpl: vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
        currentBuildSha: currentSha,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "unavailable",
        currentBuildSha: currentSha,
        reason: "upstream",
      }),
    );
  });
});
