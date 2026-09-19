---
title: Claude Platform release notes
url: https://platform.claude.com/docs/en/release-notes/overview
description: Updates to the Claude Platform, including the Claude API, client SDKs, and the Claude Console.
---

The Claude Platform release notes list changes to the Claude API, the client SDKs, and the Claude Console, newest first.

<Tip>
  For release notes on Claude Apps, see the [Release notes for Claude Apps in the Claude Help Center](https://support.claude.com/en/articles/12138966-release-notes).

  For updates to Claude Code, see the [complete CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) in the `claude-code` repository.
</Tip>

### September 18, 2026

* The [Compliance API](https://platform.claude.com/docs/en/manage-claude/compliance-api) local session endpoints now also return transcripts of Claude in Chrome sessions (`product_surface` value `claude_in_chrome`), in beta for Claude Enterprise organizations, with your existing Compliance Access Key and the `read:compliance_user_data` scope. See [Sessions on users' machines](https://platform.claude.com/docs/en/manage-claude/compliance-sessions#retrieve-local-sessions).

### September 14, 2026

* The Messages API can now [compact a conversation on demand](https://platform.claude.com/docs/en/build-with-claude/compaction#compact-on-demand-with-the-compaction-parameter) on the Claude API, in beta with the `compact-2026-09-04` beta header. Send the top-level `compaction` parameter, and the API returns a signed `compaction` block that summarizes the messages you sent. On later requests, send that block first, in place of those messages. You choose when to compact, the request can run in the background, and you can keep recent turns word for word after the summary. On models with preserved thinking, the thinking in those kept turns can stay valid.

### September 10, 2026

* Claude Managed Agents permission policies now include `auto`: the server evaluates each agent or MCP tool call and runs it, denies it, or pauses for your approval. `agent.tool_use` and `agent.mcp_tool_use` events report how each call was evaluated in an `evaluation` field alongside `evaluated_permission`. See [Let the server evaluate each call with `auto`](https://platform.claude.com/docs/en/managed-agents/permission-policies#let-the-server-evaluate-each-call-with-auto).
* Version 1.32.0 of the `ant` CLI adds `ant beta:sessions connect`, which attaches your terminal to a Claude Managed Agents session. You can follow the session live, send messages, and allow or deny tool calls that are waiting for approval. Pass `--web` to serve the Claude Console's session viewer locally and open the session there instead. See [Connect to a Managed Agents session from your terminal](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/sessions-connect).

### September 3, 2026

* Version 1.30.0 of the `ant` CLI adds `ant apply`, which creates and updates agents, environments, skills, memory stores, and deployments from files in your repository. Describe each resource in a file, run `ant apply`, and approve the plan it prints. Commit the `claude-lock.json` lockfile it writes so that later runs, on your machine or in CI, update the same resources instead of creating new ones. See [Manage resources as code with ant apply](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/apply).
* [Per-message effort](https://platform.claude.com/docs/en/build-with-claude/effort#change-effort-mid-conversation-beta) changes, in beta, are also available on [Google Cloud](https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai) for Claude Fable 5.1, Claude Mythos 5.1, and Claude Opus 5, with the same `mid-conversation-output-config-2026-07-01` beta header.

