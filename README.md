# taiga-mcp

A local MCP server connecting Claude Code to a Taiga project: read/create/update
user stories, tasks, epics, and issues; comment on items to link them to git
branches, commits, or pull requests; and attach images/files (screenshots,
mockups, docs) to any item.

> **Setup checklist:** open [`SETUP.html`](./SETUP.html) in a browser for an
> interactive, checkbox version of the steps below.

## Requirements

- Node.js 18 or newer (uses the built-in `fetch` API).

## Setup (each teammate does this once, with their own Taiga login)

1. Check your Node.js version (must be 18+):
   ```
   node -v
   ```
2. Clone the repo:
   ```
   git clone https://github.com/421648-1W3-Sanchez-German-Manuel/taiga-mcp.git
   cd taiga-mcp
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Create your `.env` file:
   ```
   cp .env.example .env
   ```
5. Fill in `.env` with **your own** Taiga login (not a shared account — this
   way comments/status changes show up under your name in Taiga):
   ```
   TAIGA_BASE_URL=https://api.taiga.io/api/v1
   TAIGA_USERNAME=your-email-or-username
   TAIGA_PASSWORD=your-password
   TAIGA_PROJECT=your-project-slug
   ```
   `TAIGA_PROJECT` is the slug from your project URL:
   `https://tree.taiga.io/project/<slug>/`
6. Register the server with Claude Code (run from inside the `taiga-mcp` folder):
   ```
   claude mcp add taiga -s user -e DOTENV_CONFIG_PATH="$(pwd)/.env" -- npx tsx "$(pwd)/src/index.ts"
   ```
   This registers it once, for all your projects (`-s user`), pointing at your
   local `.env` for credentials so nothing sensitive is stored in Claude's config.
7. Restart Claude Code (or start a new session) — MCP servers load at startup.
8. Verify the connection:
   ```
   claude mcp get taiga
   ```
   This should print `Status: ✔ Connected`.
9. (Optional) Run the smoke tests to confirm your credentials work:
   ```
   npm test
   ```
10. Try it: in a Claude Code session, ask something like "list my Taiga
    projects" or "show open user stories in my project."

## Tools

- `taiga_list_projects` — list your projects.
- `taiga_get_project` — project details (id, members, etc).
- `taiga_list_members` — project members, for resolving assignee user ids.
- `taiga_list_milestones` — sprints.
- `taiga_list_statuses` — valid status ids per entity type.
- `taiga_list_points` — the project's Fibonacci point scale (0, 1, 2, 3, 5, 8...).
- `taiga_set_points` — set a user story's estimation points (Taiga only
  supports points on user stories, not tasks/epics/issues, and stores them
  per estimating role — this handles that automatically).
- `taiga_list_items` / `taiga_get_item` — read user stories, tasks, epics, issues.
- `taiga_create_item` — create a new item (task can be linked to a user story
  via `userStory`; a user story can be linked to an epic via `epic`).
- `taiga_update_item` — change subject, description, status, assignee, sprint.
- `taiga_add_comment` — comment on an item, optionally attaching a
  branch/commit/PR URL via `linkUrl`/`linkLabel`.
- `taiga_list_attachments` — list files/images attached to an item.
- `taiga_add_attachment` — attach a local file (image, screenshot, PDF, etc.)
  to an item, given an absolute `filePath`.
- `taiga_delete_attachment` — remove a previously added attachment.

> **Note:** `taiga_create_item`, `taiga_update_item`, `taiga_add_comment`, and
> the attachment tools are write operations that have been type-checked and
> code-reviewed but **not yet run against a real Taiga project**. Test them
> against a non-critical item before relying on them for real work.

## Testing

```
npm test
```

Runs smoke tests against the real Taiga API using the credentials in `.env`.
Tests are skipped automatically if no credentials are configured.

## Roadmap (v2 ideas, not yet built)

- Auto-create/update Taiga items from PR descriptions or TODO comments in a repo.
- Caching of status/member lookups to cut down on API calls.
