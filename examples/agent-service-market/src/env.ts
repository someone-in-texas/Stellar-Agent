import { defaultExampleEnvPath, loadExampleEnvFile } from "../../shared/env.js";

export function loadMarketEnv(filePath = defaultExampleEnvPath(import.meta.url)): void {
  loadExampleEnvFile(filePath);
}
