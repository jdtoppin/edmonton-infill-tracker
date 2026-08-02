import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Vinext proxy trust", () => {
  it("preserves Caddy's HTTPS scheme without trusting a spoofed forwarded host", async () => {
    const probe = `
import { nodeToWebRequest } from "vinext/server/prod-server";

const request = nodeToWebRequest({
  headers: {
    host: "tracker.example-tailnet.ts.net:9444",
    "x-forwarded-host": "attacker.example",
    "x-forwarded-proto": "https",
  },
  method: "GET",
  url: "/",
});

process.stdout.write(request.url);
`;

    const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", probe], {
      cwd: projectRoot,
      env: {
        ...process.env,
        VINEXT_TRUST_PROXY: "1",
        VINEXT_TRUSTED_HOSTS: "",
      },
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("https://tracker.example-tailnet.ts.net:9444/");
  });
});
