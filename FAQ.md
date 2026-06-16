# CodexPro FAQ

## Which ChatGPT account should I use?

Use ChatGPT Plus or Pro with Apps / Developer Mode access.

Current testing shows free and Go accounts do not expose the app flow needed for CodexPro.

CodexPro does not unlock Developer Mode, unlock models, or bypass account limits. It connects to the ChatGPT app surface your account already has.

## What is the recommended install path?

Install globally once:

```bash
npm install -g codexpro
```

Then run setup from the repo you want ChatGPT to work on:

```bash
codexpro setup
```

After setup, daily startup from that same repo is:

```bash
codexpro start
```

`npx codexpro@latest start` still works as a no-install fallback, but the global install is easier for normal users.

## What do I enable in ChatGPT?

Open ChatGPT and go to:

```text
Settings
-> Apps
-> Advanced settings
-> Developer mode: on
-> Enforce CSP in developer mode: on
-> Create app
```

In Create App:

```text
Name: CodexPro
Description: Local workspace bridge for ChatGPT coding
Connection: Server URL
Server URL: paste the URL copied by CodexPro
Authentication: No Authentication / None
```

The copied Server URL already includes the private CodexPro token.

## Should CSP stay enabled?

Yes. Keep Enforce CSP in developer mode enabled.

CodexPro widgets are built for the CSP-enabled path. They do not need unrestricted network access, external fonts, remote scripts, iframes, or third-party images.

## Does CodexPro bypass rate limits?

No.

CodexPro does not change ChatGPT, Codex, or OpenAI limits. It gives a ChatGPT account that already has Developer Mode app access a local repo bridge through MCP.

The useful part is that Codex and ChatGPT are different product surfaces with separate usage policies. If Codex is constrained and your ChatGPT plan still has capacity, CodexPro lets you keep working from ChatGPT against the same local repo.

## Can CodexPro use GPT-5.5?

Only if your ChatGPT account already exposes that model or a similar stronger model in the ChatGPT web product surface you are using.

CodexPro does not provide models. It gives the ChatGPT session local repo tools.

## What can ChatGPT see through CodexPro?

ChatGPT can see explicit workspace context exposed by tools:

- `AGENTS.md`
- `.ai-bridge` plans and status files
- git status
- git diff
- selected source files
- file tree and search results

It cannot read hidden Codex runtime memory or anything outside the allowed workspace unless you explicitly allow that root.

## What can ChatGPT edit?

In normal coding mode, ChatGPT can write and exact-edit files inside the configured workspace.

Safety defaults block common sensitive paths:

- `.env`
- private keys
- `.git`
- `node_modules`
- generated build/cache folders
- symlink escapes
- paths outside the workspace

Use handoff mode if you want ChatGPT to write a plan only and let Codex execute locally.

## Which tunnel should I choose?

Use this rule:

```text
Fast demo:              Cloudflare quick tunnel
Recommended stable URL: ngrok free dev domain
Custom domain:          Cloudflare named tunnel
No public tunnel:       local-only mode, only for clients that can reach localhost
```

Cloudflare quick tunnel URLs change on restart. If you put a quick-mode URL into ChatGPT, you must edit the ChatGPT app Server URL every time you restart the tunnel.

For most users, the better path is a free ngrok dev domain. Create a free ngrok account, find your assigned dev domain under Universal Gateway -> Domains, and save that hostname during `codexpro setup`.

If you own a domain, use Cloudflare named tunnels and route DNS to a hostname like `codexpro.example.com`.

Official references:

- ngrok dev domains: https://ngrok.com/docs/universal-gateway/domains
- Cloudflare Tunnel routing: https://developers.cloudflare.com/tunnel/routing/
- Cloudflare Tunnel DNS records: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/

## Can I use the same ChatGPT app URL every day?

Yes, if you use a stable hostname.

Recommended simple path:

```bash
codexpro setup
# choose ngrok
# enter your ngrok free dev domain
```

After that:

```bash
codexpro start
```

The same hostname and CodexPro token are reused for that workspace.

## What if I run CodexPro in two repos at once?

Use different local ports and different tunnel hostnames.

Example:

```text
repo A: port 8787, hostname A
repo B: port 8788, hostname B
```

Run `codexpro setup` in each repo and save a profile per workspace.

## Why not use codexpro.github.io?

GitHub Pages gives `owner.github.io` only to the GitHub user or organization named `owner`.

The `codexpro` GitHub username already exists, so this repo cannot use `codexpro.github.io` from the `rebel0789` account.

The clean GitHub Pages URL for this project is:

```text
https://rebel0789.github.io/codexpro/
```

## Is CodexPro production safe?

CodexPro is a local developer bridge, not an OS sandbox.

Use it with repos you trust. Keep token auth enabled for public tunnels. Keep safe bash on unless you know why you need full bash. Read [SECURITY.md](SECURITY.md) before exposing it through a public tunnel.

## Where are saved settings stored?

Workspace profiles are saved under:

```text
~/.codexpro/profiles/
```

Use:

```bash
codexpro settings
codexpro settings list
codexpro settings delete --yes
```

Saved tokens are redacted when profiles are displayed.
