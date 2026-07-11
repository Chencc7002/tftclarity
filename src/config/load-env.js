import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const DEFAULT_ENV_PATH = fileURLToPath(new URL("../../.env", import.meta.url));

export function loadLocalEnvironment(options = {}) {
  const envPath = resolve(options.path ?? DEFAULT_ENV_PATH);
  const processEnv = options.processEnv ?? process.env;
  const result = dotenv.config({
    path: envPath,
    processEnv,
    override: false,
    quiet: true
  });

  if (result.error && result.error.code !== "ENOENT") throw result.error;
  return {
    loaded: !result.error,
    path: envPath,
    keys: Object.keys(result.parsed ?? {})
  };
}
