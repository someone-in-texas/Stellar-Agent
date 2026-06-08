import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("manual wallet examples", () => {
  it("keeps the Freighter example clearly manual and command-complete", async () => {
    const readme = await readFile(join("examples", "freighter-manual", "README.md"), "utf8");

    expect(readme).toContain("Manual test only.");
    expect(readme).toContain("not part of the default automated test suite");
    expect(readme).toContain("browser with the Freighter extension");
    expect(readme).toContain("stellar-agent --json tx request-payment-signature");
    expect(readme).toContain("stellar-agent approval serve --json");
    expect(readme).toContain("Sign With Freighter");
    expect(readme).toContain("stellar-agent --json approval show");
    expect(readme).toContain("stellar-agent --json tx submit-approval");
  });

  it("keeps the WalletConnect example clearly manual and command-complete", async () => {
    const readme = await readFile(join("examples", "walletconnect-manual", "README.md"), "utf8");

    expect(readme).toContain("Manual test only.");
    expect(readme).toContain("not part of the default automated test suite");
    expect(readme).toContain("WalletConnect project id");
    expect(readme).toContain("stellar-agent --json wallet walletconnect pair");
    expect(readme).toContain("stellar-agent --json wallet walletconnect status");
    expect(readme).toContain("stellar-agent --json tx request-payment-signature");
    expect(readme).toContain("stellar-agent --json approval sign-walletconnect");
    expect(readme).toContain("stellar_signXDR");
    expect(readme).toContain("stellar-agent --json wallet walletconnect disconnect");
  });
});
