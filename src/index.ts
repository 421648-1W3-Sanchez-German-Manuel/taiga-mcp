#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EntityType, loadConfigFromEnv, TaigaClient } from "./taiga-client.js";

const config = loadConfigFromEnv();
const taiga = new TaigaClient(config);

const server = new McpServer({ name: "taiga-mcp", version: "0.1.0" });

const projectRefSchema = z
  .string()
  .optional()
  .describe(
    "Project slug or numeric id. Omit to use the configured default project (TAIGA_PROJECT)."
  );

function toResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function toErrorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

async function safe(fn: () => Promise<unknown>) {
  try {
    return toResult(await fn());
  } catch (err) {
    return toErrorResult(err);
  }
}

// ---- Projects & metadata ----

server.registerTool(
  "taiga_list_projects",
  {
    description: "List Taiga projects you are a member of.",
    inputSchema: {},
  },
  async () => safe(() => taiga.listProjects())
);

server.registerTool(
  "taiga_get_project",
  {
    description: "Get details of a Taiga project, including its id (needed for other calls).",
    inputSchema: { project: projectRefSchema },
  },
  async ({ project }) => safe(() => taiga.getProject(project))
);

server.registerTool(
  "taiga_list_members",
  {
    description: "List members of a project, to look up user ids for assignment.",
    inputSchema: { project: projectRefSchema },
  },
  async ({ project }) => safe(() => taiga.listMembers(project))
);

server.registerTool(
  "taiga_list_milestones",
  {
    description: "List sprints (milestones) of a project.",
    inputSchema: { project: projectRefSchema },
  },
  async ({ project }) => safe(() => taiga.listMilestones(project))
);

const entityTypeSchema = z
  .enum(["userstory", "task", "epic", "issue"])
  .describe("The Taiga entity type.");

server.registerTool(
  "taiga_list_statuses",
  {
    description:
      "List valid statuses for a given entity type in a project. Needed to know which status id to pass when updating an item.",
    inputSchema: { type: entityTypeSchema, project: projectRefSchema },
  },
  async ({ type, project }) => safe(() => taiga.listStatuses(type as EntityType, project))
);

server.registerTool(
  "taiga_list_points",
  {
    description:
      "List the project's point scale (e.g. 0, 1, 2, 3, 5, 8, 13...). Use this to see valid values before calling taiga_set_points.",
    inputSchema: { project: projectRefSchema },
  },
  async ({ project }) => safe(() => taiga.listPoints(project))
);

server.registerTool(
  "taiga_list_roles",
  {
    description:
      "List a project's roles, including which are 'computable' (i.e. estimate user stories). " +
      "Use this to find a role id/name to pass to taiga_set_points on a project with more than one estimating role.",
    inputSchema: { project: projectRefSchema },
  },
  async ({ project }) => safe(() => taiga.listRoles(project))
);

server.registerTool(
  "taiga_set_points",
  {
    description:
      "Set a user story's estimation points to a value from the project's point scale (see taiga_list_points). " +
      "Only user stories have points in Taiga (not tasks, epics, or issues). If the project has exactly one " +
      "estimating role, the value is applied there automatically; if it has several (see taiga_list_roles), " +
      "'role' is required to say which one to set, so other roles' existing estimates aren't touched.",
    inputSchema: {
      id: z.number().describe("The user story's numeric id."),
      points: z.number().describe("A value from the project's point scale, e.g. 5."),
      project: projectRefSchema,
      role: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          "Role id or name to set points for (see taiga_list_roles). Required when the project has more than one estimating role."
        ),
    },
  },
  async ({ id, points, project, role }) => safe(() => taiga.setPoints(id, points, project, role))
);

// ---- Read ----

const listFiltersSchema = {
  project: projectRefSchema,
  status: z.number().optional().describe("Filter by status id (see taiga_list_statuses)."),
  milestone: z.number().optional().describe("Filter by sprint/milestone id."),
  assignedTo: z.number().optional().describe("Filter by assigned user id."),
  userStory: z
    .number()
    .optional()
    .describe("Filter tasks belonging to a specific user story id (tasks only)."),
};

server.registerTool(
  "taiga_list_items",
  {
    description:
      "List user stories, tasks, epics, or issues in a project, optionally filtered by status/milestone/assignee.",
    inputSchema: { type: entityTypeSchema, ...listFiltersSchema },
  },
  async ({ type, ...filters }) =>
    safe(() =>
      taiga.list(type as EntityType, {
        projectRef: filters.project,
        status: filters.status,
        milestone: filters.milestone,
        assignedTo: filters.assignedTo,
        userStory: filters.userStory,
      })
    )
);

server.registerTool(
  "taiga_get_item",
  {
    description: "Get full details of a single user story, task, epic, or issue by id.",
    inputSchema: { type: entityTypeSchema, id: z.number().describe("The item's numeric id.") },
  },
  async ({ type, id }) => safe(() => taiga.get(type as EntityType, id))
);

// ---- Create ----

server.registerTool(
  "taiga_create_item",
  {
    description:
      "Create a new user story, task, epic, or issue in a project. For tasks, pass user_story in extraFields to attach it to a user story.",
    inputSchema: {
      type: entityTypeSchema,
      project: projectRefSchema,
      subject: z.string().describe("Title of the item."),
      description: z.string().optional(),
      status: z.number().optional().describe("Status id (see taiga_list_statuses)."),
      assignedTo: z.number().optional().describe("User id to assign."),
      milestone: z.number().optional().describe("Sprint/milestone id (user stories)."),
      userStory: z.number().optional().describe("Parent user story id (tasks only)."),
      epic: z.number().optional().describe("Parent epic id (to link a user story to an epic)."),
    },
  },
  async ({ type, project, subject, description, status, assignedTo, milestone, userStory, epic }) =>
    safe(() =>
      taiga.create(type as EntityType, project, {
        subject,
        description,
        status,
        assigned_to: assignedTo,
        milestone,
        user_story: userStory,
        epic,
      })
    )
);

// ---- Update ----

server.registerTool(
  "taiga_update_item",
  {
    description:
      "Update fields on an existing user story, task, epic, or issue (e.g. change status, assignee, sprint, points, description).",
    inputSchema: {
      type: entityTypeSchema,
      id: z.number().describe("The item's numeric id."),
      subject: z.string().optional(),
      description: z.string().optional(),
      status: z.number().optional().describe("Status id (see taiga_list_statuses)."),
      assignedTo: z.number().optional().describe("User id to assign, or null to unassign."),
      milestone: z.number().optional().describe("Sprint/milestone id."),
      epic: z
        .number()
        .optional()
        .describe("Epic id to link this user story to (user stories only; adds the link, does not replace existing epic links)."),
    },
  },
  async ({ type, id, subject, description, status, assignedTo, milestone, epic }) =>
    safe(async () => {
      const hasFieldUpdate =
        subject !== undefined ||
        description !== undefined ||
        status !== undefined ||
        assignedTo !== undefined ||
        milestone !== undefined;
      if (hasFieldUpdate) {
        await taiga.update(type as EntityType, id, {
          ...(subject !== undefined && { subject }),
          ...(description !== undefined && { description }),
          ...(status !== undefined && { status }),
          ...(assignedTo !== undefined && { assigned_to: assignedTo }),
          ...(milestone !== undefined && { milestone }),
        });
      }
      if (epic !== undefined) {
        if (type !== "userstory") throw new Error("epic linking only applies to user stories");
        await taiga.linkEpic(epic, id);
      }
      return taiga.get(type as EntityType, id);
    })
);

// ---- Comments / linking to work ----

server.registerTool(
  "taiga_add_comment",
  {
    description:
      "Add a comment to a user story, task, epic, or issue. Use `link` to attach a git branch, commit, or PR URL to the item, connecting it to the actual work.",
    inputSchema: {
      type: entityTypeSchema,
      id: z.number().describe("The item's numeric id."),
      comment: z.string().describe("Comment text."),
      linkUrl: z.string().optional().describe("A branch, commit, or PR URL to attach."),
      linkLabel: z
        .string()
        .optional()
        .describe("Label for the link, e.g. 'Pull Request' or 'Commit'. Defaults to 'Link'."),
    },
  },
  async ({ type, id, comment, linkUrl, linkLabel }) =>
    safe(() =>
      taiga.addComment(
        type as EntityType,
        id,
        comment,
        linkUrl ? { url: linkUrl, label: linkLabel } : undefined
      )
    )
);

// ---- Attachments (images, screenshots, files) ----

server.registerTool(
  "taiga_list_attachments",
  {
    description: "List files/images attached to a user story, task, epic, or issue.",
    inputSchema: { type: entityTypeSchema, id: z.number().describe("The item's numeric id.") },
  },
  async ({ type, id }) => safe(() => taiga.listAttachments(type as EntityType, id))
);

server.registerTool(
  "taiga_add_attachment",
  {
    description:
      "Attach a local file (image, screenshot, PDF, etc.) to a user story, task, epic, or issue. " +
      "`filePath` must be an absolute path to a file readable on this machine (e.g. a screenshot you've just saved).",
    inputSchema: {
      type: entityTypeSchema,
      id: z.number().describe("The item's numeric id."),
      filePath: z.string().describe("Absolute path to the local file to upload."),
      description: z.string().optional().describe("Optional caption/description for the attachment."),
    },
  },
  async ({ type, id, filePath, description }) =>
    safe(() => taiga.addAttachment(type as EntityType, id, filePath, description))
);

server.registerTool(
  "taiga_delete_attachment",
  {
    description: "Remove a previously added attachment from an item.",
    inputSchema: {
      type: entityTypeSchema,
      attachmentId: z.number().describe("The attachment's numeric id (see taiga_list_attachments)."),
    },
  },
  async ({ type, attachmentId }) =>
    safe(() => taiga.deleteAttachment(type as EntityType, attachmentId))
);

const transport = new StdioServerTransport();
await server.connect(transport);
