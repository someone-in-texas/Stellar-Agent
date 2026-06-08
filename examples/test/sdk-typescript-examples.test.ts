import { describe, expect, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

describe("TypeScript SDK examples", () => {
  it("typechecks direct package import examples", () => {
    const configPath = fileURLToPath(new URL("../sdk-typescript/tsconfig.json", import.meta.url));
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(configFile.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath), undefined, configPath);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(formatDiagnostics(diagnostics)).toBe("");
  });
});

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const location =
        diagnostic.file && diagnostic.start !== undefined
          ? `${diagnostic.file.fileName}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
          : "unknown";
      return `${location} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    })
    .join("\n");
}
