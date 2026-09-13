# taiga-mcp

A local MCP server connecting Claude Code to a Taiga project: read/create/update
user stories, tasks, epics, and issues, plus comment on items to link them to
git branches, commits, or pull requests.

## Requirements

- Node.js 18 or newer (uses the built-in `fetch` API). Check with `node -v`.

## Setup (each teammate does this once, with their own Taiga login)

1. Clone this repo and install dependencies:
   ```
   git clone <this-repo-url> taiga-mcp
   cd taiga-mcp
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in **your own** Taiga username/password
   and the team's default project slug or id:
   ```
   cp .env.example .env
   ```
   Everyone should use their own Taiga credentials here, not a shared account —
   that way actions in Taiga (comments, status changes) show up under the
   right person.
3. Register the server with Claude Code (run from inside the `taiga-mcp` folder):
   ```
   claude mcp add taiga -s user -e DOTENV_CONFIG_PATH="$(pwd)/.env" -- npx tsx "$(pwd)/src/index.ts"
   ```
   This registers it once, for all your projects (`-s user`), pointing at your
   local `.env` for credentials so nothing sensitive is stored in Claude's config.
4. Restart Claude Code. Run `claude mcp get taiga` to confirm it shows
   `Status: ✔ Connected`.

## Tools

- `taiga_list_projects` — list your projects.
- `taiga_get_project` — project details (id, members, etc).
- `taiga_list_members` — project members, for resolving assignee user ids.
- `taiga_list_milestones` — sprints.
- `taiga_list_statuses` — valid status ids per entity type.
- `taiga_list_items` / `taiga_get_item` — read user stories, tasks, epics, issues.
- `taiga_create_item` — create a new item (task can be linked to a user story
  via `userStory`; a user story can be linked to an epic via `epic`).
- `taiga_update_item` — change subject, description, status, assignee, sprint.
- `taiga_add_comment` — comment on an item, optionally attaching a
  branch/commit/PR URL via `linkUrl`/`linkLabel`.

## Testing

```
npm test
```

Runs smoke tests against the real Taiga API using the credentials in `.env`.
Tests are skipped automatically if no credentials are configured.

## Roadmap (v2 ideas, not yet built)

- Auto-create/update Taiga items from PR descriptions or TODO comments in a repo.
- Caching of status/member lookups to cut down on API calls.
