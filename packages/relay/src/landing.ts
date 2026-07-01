const INSTALL_ONE_LINER = "npm install -g pairrelay";

export function renderJoinLandingPage(options: {
  sessionId: string;
  token: string;
  relayUrl: string;
  expiresAt?: string;
  repo?: string;
  branch?: string;
}): string {
  const joinCommand = `pairrelay join ${options.sessionId} --token ${options.token}`;
  const relayFlag =
    options.relayUrl && !options.relayUrl.includes("localhost")
      ? ` --relay-url ${options.relayUrl}`
      : "";
  const fullJoinCommand = `${joinCommand}${relayFlag}`;
  const expiryLine = options.expiresAt
    ? `<p class="meta">Link expires: <time>${escapeHtml(options.expiresAt)}</time></p>`
    : "";
  const contextLine =
    options.repo
      ? `<p class="meta">Repo: <strong>${escapeHtml(options.repo)}</strong>${options.branch ? ` (${escapeHtml(options.branch)})` : ""}</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Join pairrelay session</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    h1 { font-size: 1.5rem; }
    pre, code { font-family: ui-monospace, monospace; font-size: 0.9rem; }
    pre { background: color-mix(in srgb, CanvasText 8%, Canvas); padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .meta { color: color-mix(in srgb, CanvasText 65%, Canvas); font-size: 0.95rem; }
    button { margin-top: 0.5rem; padding: 0.5rem 1rem; cursor: pointer; }
    ol { padding-left: 1.25rem; }
    li { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>Join shared AI session</h1>
  <p>A teammate shared a live pairrelay session. Install the CLI, then run the join command.</p>
  ${contextLine}
  ${expiryLine}

  <h2>1. Install</h2>
  <pre id="install-cmd">${escapeHtml(INSTALL_ONE_LINER)}</pre>
  <button type="button" onclick="copyText('install-cmd')">Copy install command</button>

  <h2>2. Log in</h2>
  <p>First time only:</p>
  <pre id="login-cmd">pairrelay login --github</pre>
  <p class="meta">Or use an API key: <code>pairrelay login --api-key &lt;key&gt;</code></p>

  <h2>3. Join session</h2>
  <pre id="join-cmd">${escapeHtml(fullJoinCommand)}</pre>
  <button type="button" onclick="copyText('join-cmd')">Copy join command</button>

  <h2>4. Connect Cursor</h2>
  <ol>
    <li>Add MCP config: <code>pairrelay mcp</code> in <code>.cursor/mcp.json</code></li>
    <li>Reload MCP in Cursor</li>
    <li>Ask the agent to call <code>pairrelay_get_session</code></li>
  </ol>

  <script>
    function copyText(id) {
      const el = document.getElementById(id);
      navigator.clipboard.writeText(el.textContent).then(() => {
        const btn = event.target;
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = prev; }, 1500);
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { INSTALL_ONE_LINER };
