import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = join(root, "packages/cli");

mkdirSync(cliDir, { recursive: true });
copyFileSync(join(root, "README.md"), join(cliDir, "README.md"));

console.log("prepack: copied README.md into packages/cli");
