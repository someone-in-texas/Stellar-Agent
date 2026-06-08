import { defaultExampleEnvPath, loadExampleEnvFile } from "../../shared/env.js";

export function loadExampleEnv(filePath = defaultExampleEnvPath(import.meta.url)): void {
  loadExampleEnvFile(filePath);
}
