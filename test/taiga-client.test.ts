import { test } from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";
import { loadConfigFromEnv, TaigaClient } from "../src/taiga-client.js";

const hasCreds = !!process.env.TAIGA_USERNAME && !!process.env.TAIGA_PASSWORD;

test(
  "authenticates and lists projects against the real Taiga API",
  { skip: !hasCreds && "set TAIGA_USERNAME/TAIGA_PASSWORD in .env to run this test" },
  async () => {
    const client = new TaigaClient(loadConfigFromEnv());
    const projects = await client.listProjects();
    assert.ok(Array.isArray(projects));
  }
);

test(
  "resolves the default project and reads its statuses",
  {
    skip:
      !hasCreds || !process.env.TAIGA_PROJECT
        ? "set TAIGA_USERNAME/TAIGA_PASSWORD/TAIGA_PROJECT in .env to run this test"
        : false,
  },
  async () => {
    const client = new TaigaClient(loadConfigFromEnv());
    const statuses = await client.listStatuses("userstory");
    assert.ok(Array.isArray(statuses));
    assert.ok(statuses.length > 0);
  }
);
