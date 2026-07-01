import { createServer } from "node:http";
import { exec } from "node:child_process";
import { DEFAULT_RELAY_URL, writeCredentials } from "@pairrelay/shared";
import { resolveRelayUrl } from "../relay-api.js";

export interface LoginOptions {
  apiKey?: string;
  relayUrl?: string;
  github?: boolean;
}

export interface GitHubLoginOptions {
  relayUrl?: string;
}

interface CallbackQuery {
  api_key?: string;
  sig?: string;
  github_login?: string;
  email?: string;
  error?: string;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

function parseCallbackUrl(requestUrl: string): CallbackQuery {
  const url = new URL(requestUrl, "http://127.0.0.1");
  return {
    api_key: url.searchParams.get("api_key") ?? undefined,
    sig: url.searchParams.get("sig") ?? undefined,
    github_login: url.searchParams.get("github_login") ?? undefined,
    email: url.searchParams.get("email") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  };
}

export async function runGitHubLogin(options: GitHubLoginOptions): Promise<void> {
  const relayUrl = await resolveRelayUrl(options.relayUrl);

  const { apiKey, githubLogin } = await new Promise<{ apiKey: string; githubLogin?: string }>(
    (resolve, reject) => {
      const server = createServer((req, res) => {
        if (!req.url?.startsWith("/callback")) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const query = parseCallbackUrl(req.url);
        if (query.error) {
          res.writeHead(400, { "content-type": "text/html" });
          res.end(`<h1>Login failed</h1><p>${query.error}</p>`);
          server.close();
          reject(new Error(query.error));
          return;
        }

        if (!query.api_key) {
          res.writeHead(400, { "content-type": "text/html" });
          res.end("<h1>Login failed</h1><p>Missing API key</p>");
          server.close();
          reject(new Error("OAuth callback missing api_key"));
          return;
        }

        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h1>Login successful</h1><p>You can close this tab and return to the terminal.</p>");
        server.close();
        resolve({ apiKey: query.api_key, githubLogin: query.github_login });
      });

      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Failed to bind local callback server"));
          return;
        }

        const cliPort = address.port;
        const authUrl = new URL(`${relayUrl}/auth/github`);
        authUrl.searchParams.set("cli_port", String(cliPort));

        console.log("");
        console.log("Opening browser for GitHub login...");
        console.log(`If it does not open, visit: ${authUrl.toString()}`);
        console.log("");

        openBrowser(authUrl.toString());

        setTimeout(() => {
          server.close();
          reject(new Error("GitHub login timed out after 5 minutes"));
        }, 5 * 60 * 1000).unref();
      });

      server.on("error", reject);
    },
  );

  await writeCredentials({ api_key: apiKey, relay_url: relayUrl });

  console.log("");
  console.log("Credentials saved to ~/.pairrelay/credentials");
  console.log(`  Relay: ${relayUrl}`);
  if (githubLogin) {
    console.log(`  GitHub: @${githubLogin}`);
  }
  console.log("");
}

export async function runApiKeyLogin(options: {
  apiKey?: string;
  relayUrl?: string;
}): Promise<void> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin: input, stdout: output } = await import("node:process");

  let apiKey = options.apiKey?.trim();

  if (!apiKey) {
    const rl = createInterface({ input, output });
    try {
      apiKey = (await rl.question("API key: ")).trim();
    } finally {
      rl.close();
    }
  }

  if (!apiKey) {
    throw new Error("API key is required. Use --api-key or enter it when prompted.");
  }

  const relayUrl = options.relayUrl ?? DEFAULT_RELAY_URL;
  await writeCredentials({ api_key: apiKey, relay_url: relayUrl });

  console.log("");
  console.log("Credentials saved to ~/.pairrelay/credentials");
  console.log(`  Relay: ${relayUrl}`);
  console.log("");
}

export async function runLogin(options: LoginOptions): Promise<void> {
  if (options.github) {
    await runGitHubLogin({ relayUrl: options.relayUrl });
    return;
  }
  await runApiKeyLogin({ apiKey: options.apiKey, relayUrl: options.relayUrl });
}
