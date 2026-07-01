/**
 * @deprecated Use `pairrelay post <message>` instead.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../packages/cli/dist/index.js");
const message = process.argv[2] ?? "hello from daemon client";

const child = spawn("node", [cli, "post", message], { stdio: "inherit", shell: true });
child.on("close", (code) => process.exit(code ?? 0));
