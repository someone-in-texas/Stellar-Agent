import { defaultExampleEnvPath, loadExampleEnvFile } from "../../shared/env.js";

export function loadPlaygroundEnv(filePath = defaultExampleEnvPath(import.meta.url)): void {
  loadExampleEnvFile(filePath);
}
