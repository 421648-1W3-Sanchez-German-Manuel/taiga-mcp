export type EntityType = "userstory" | "task" | "epic" | "issue";

const ENTITY_ENDPOINT: Record<EntityType, string> = {
  userstory: "userstories",
  task: "tasks",
  epic: "epics",
  issue: "issues",
};

export interface TaigaConfig {
  baseUrl: string;
  username: string;
  password: string;
  defaultProject: string;
}

export function loadConfigFromEnv(): TaigaConfig {
  const baseUrl = process.env.TAIGA_BASE_URL || "https://api.taiga.io/api/v1";
  const username = process.env.TAIGA_USERNAME;
  const password = process.env.TAIGA_PASSWORD;
  const defaultProject = process.env.TAIGA_PROJECT || "";

  if (!username || !password) {
    throw new Error(
      "TAIGA_USERNAME and TAIGA_PASSWORD must be set (see .env.example)."
    );
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), username, password, defaultProject };
}

export class TaigaClient {
  private token: string | null = null;
  private userId: number | null = null;
  private projectIdCache = new Map<string, number>();

  constructor(private config: TaigaConfig) {}

  private async ensureAuth(): Promise<string> {
    if (this.token) return this.token;

    const res = await fetch(`${this.config.baseUrl}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "normal",
        username: this.config.username,
        password: this.config.password,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Taiga login failed (${res.status}): ${await res.text()}`
      );
    }

    const data = (await res.json()) as { auth_token: string; id: number };
    this.token = data.auth_token;
    this.userId = data.id;
    return this.token;
  }

  private async requestRaw(
    path: string,
    options: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}
  ): Promise<{ data: any; headers: Headers }> {
    const token = await this.ensureAuth();
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      // Let fetch set the multipart Content-Type (with boundary) itself.
      body = options.body;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await fetch(url, {
      method: options.method || "GET",
      headers,
      body,
    });

    if (res.status === 204) return { data: undefined, headers: res.headers };

    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;

    if (!res.ok) {
      throw new Error(
        `Taiga API error ${res.status} on ${options.method || "GET"} ${path}: ${text}`
      );
    }

    return { data, headers: res.headers };
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}
  ): Promise<T> {
    const { data } = await this.requestRaw(path, options);
    return data as T;
  }

  /**
   * Fetches all pages of a Taiga list endpoint. Taiga paginates list responses
   * (default page size ~30) and reports the total via the x-pagination-count
   * header, so a plain single request would silently truncate large lists.
   */
  private async requestAllPages<T>(
    path: string,
    query: Record<string, unknown> = {}
  ): Promise<T[]> {
    const pageSize = 100;
    const results: T[] = [];
    let page = 1;

    while (true) {
      const { data, headers } = await this.requestRaw(path, {
        query: { ...query, page, page_size: pageSize },
      });
      const items = (data as T[]) ?? [];
      results.push(...items);

      const totalCountHeader = headers.get("x-pagination-count");
      const totalCount = totalCountHeader ? Number(totalCountHeader) : null;

      if (items.length < pageSize) break;
      if (totalCount !== null && results.length >= totalCount) break;
      page++;
    }

    return results;
  }

  /** Resolves a project slug or numeric id (or the configured default) to a numeric project id. */
  async resolveProjectId(projectRef?: string): Promise<number> {
    const ref = projectRef || this.config.defaultProject;
    if (!ref) {
      throw new Error(
        "No project specified and no TAIGA_PROJECT default configured."
      );
    }

    if (/^\d+$/.test(ref)) return Number(ref);

    if (this.projectIdCache.has(ref)) return this.projectIdCache.get(ref)!;

    const project = await this.request<{ id: number }>("/projects/by_slug", {
      query: { slug: ref },
    });
    this.projectIdCache.set(ref, project.id);
    return project.id;
  }

  async listProjects() {
    await this.ensureAuth();
    return this.requestAllPages<any>("/projects", { member: this.userId! });
  }

  async getProject(projectRef?: string) {
    const id = await this.resolveProjectId(projectRef);
    return this.request<any>(`/projects/${id}`);
  }

  async listMembers(projectRef?: string) {
    const project = await this.resolveProjectId(projectRef);
    return this.request<any[]>("/memberships", { query: { project } });
  }

  async listMilestones(projectRef?: string) {
    const project = await this.resolveProjectId(projectRef);
    return this.request<any[]>("/milestones", { query: { project } });
  }

  async listStatuses(type: EntityType, projectRef?: string) {
    const project = await this.resolveProjectId(projectRef);
    const endpoint =
      type === "userstory"
        ? "userstory-statuses"
        : type === "task"
        ? "task-statuses"
        : type === "epic"
        ? "epic-statuses"
        : "issue-statuses";
    return this.request<any[]>(`/${endpoint}`, { query: { project } });
  }

  /** The project's Fibonacci-style point scale (e.g. 0, 1, 2, 3, 5, 8, 13...), each with an id. */
  async listPoints(projectRef?: string) {
    const project = await this.resolveProjectId(projectRef);
    return this.request<any[]>("/points", { query: { project } });
  }

  /** Roles that estimate user stories (e.g. Design, Development). */
  async listRoles(projectRef?: string) {
    const project = await this.resolveProjectId(projectRef);
    return this.request<any[]>("/roles", { query: { project } });
  }

  /**
   * Sets a user story's points to a given Fibonacci value. Taiga stores
   * points per-role as a mapping of role id -> points-scale-entry id (not
   * the raw number), and totals by summing every role's entry — so on a
   * project with several computable roles (e.g. UX/Design/Front/Back),
   * blindly writing the same value to every role would inflate the total
   * instead of representing a single estimate. When the project has more
   * than one computable role, `role` (its id or name, see listRoles) must
   * say which one to set; with exactly one computable role it's applied
   * there automatically, matching the old single-role behavior.
   */
  async setPoints(id: number, value: number, projectRef?: string, role?: number | string) {
    const story = await this.get("userstory", id);
    const project = projectRef ? await this.resolveProjectId(projectRef) : story.project;

    const [points, roles] = await Promise.all([
      this.listPoints(String(project)),
      this.listRoles(String(project)),
    ]);

    const pointEntry = points.find((p: any) => p.value === value);
    if (!pointEntry) {
      const available = points.map((p: any) => p.value).join(", ");
      throw new Error(
        `No point value ${value} in this project's scale. Available values: ${available}`
      );
    }

    const computableRoles = roles.filter((r: any) => r.computable);
    if (computableRoles.length === 0) {
      throw new Error("This project has no computable (estimating) roles.");
    }

    let targetRoles: any[];
    if (role !== undefined) {
      const match = computableRoles.find((r: any) =>
        typeof role === "number"
          ? r.id === role
          : r.name.toLowerCase() === role.toLowerCase() || r.slug === role
      );
      if (!match) {
        const available = computableRoles.map((r: any) => `${r.name} (id ${r.id})`).join(", ");
        throw new Error(`No computable role '${role}' in this project. Available: ${available}`);
      }
      targetRoles = [match];
    } else if (computableRoles.length === 1) {
      targetRoles = computableRoles;
    } else {
      const available = computableRoles.map((r: any) => `${r.name} (id ${r.id})`).join(", ");
      throw new Error(
        `This project has multiple computable roles; pass 'role' to say which one to set. Available: ${available}`
      );
    }

    const existingPoints: Record<string, number> = { ...(story.points || {}) };
    for (const r of targetRoles) {
      existingPoints[String(r.id)] = pointEntry.id;
    }

    return this.update("userstory", id, { points: existingPoints });
  }

  async list(
    type: EntityType,
    filters: {
      projectRef?: string;
      status?: number;
      milestone?: number;
      assignedTo?: number;
      userStory?: number;
    } = {}
  ) {
    const project = await this.resolveProjectId(filters.projectRef);
    return this.requestAllPages<any>(`/${ENTITY_ENDPOINT[type]}`, {
      project,
      status: filters.status,
      milestone: filters.milestone,
      assigned_to: filters.assignedTo,
      user_story: filters.userStory,
    });
  }

  async get(type: EntityType, id: number) {
    return this.request<any>(`/${ENTITY_ENDPOINT[type]}/${id}`);
  }

  async create(type: EntityType, projectRef: string | undefined, fields: Record<string, unknown>) {
    const project = await this.resolveProjectId(projectRef);
    // Taiga's userstory create endpoint silently ignores an `epic` field: linking
    // to an epic is a separate relation, set via linkEpic() after creation.
    const { epic, ...rest } = fields;
    const created = await this.request<any>(`/${ENTITY_ENDPOINT[type]}`, {
      method: "POST",
      body: { project, ...rest },
    });
    if (type === "userstory" && typeof epic === "number") {
      await this.linkEpic(epic, created.id);
      return this.get(type, created.id);
    }
    return created;
  }

  /** Links a user story to an epic (Taiga models this as its own relation, not a field on the story). */
  async linkEpic(epicId: number, userStoryId: number) {
    return this.request<any>(`/epics/${epicId}/related_userstories`, {
      method: "POST",
      body: { epic: epicId, user_story: userStoryId },
    });
  }

  /** Removes the link between a user story and an epic. */
  async unlinkEpic(epicId: number, userStoryId: number) {
    await this.requestRaw(`/epics/${epicId}/related_userstories/${userStoryId}`, {
      method: "DELETE",
    });
  }

  async update(type: EntityType, id: number, fields: Record<string, unknown>) {
    // Taiga requires the current `version` for optimistic-locking on PATCH.
    const current = await this.get(type, id);
    return this.request<any>(`/${ENTITY_ENDPOINT[type]}/${id}`, {
      method: "PATCH",
      body: { version: current.version, ...fields },
    });
  }

  /** Adds a comment to an item, optionally appending a link (e.g. a PR or commit URL). */
  async addComment(
    type: EntityType,
    id: number,
    comment: string,
    link?: { url: string; label?: string }
  ) {
    const text = link ? `${comment}\n\n${link.label || "Link"}: ${link.url}` : comment;
    return this.update(type, id, { comment: text });
  }

  /** List files/images attached to an item. */
  async listAttachments(type: EntityType, id: number) {
    const item = await this.get(type, id);
    return this.request<any[]>(`/${ENTITY_ENDPOINT[type]}/attachments`, {
      query: { object_id: id, project: item.project },
    });
  }

  /**
   * Attaches a local file (image, screenshot, doc, etc.) to a user story,
   * task, epic, or issue. `filePath` must point to a file readable on this
   * machine.
   */
  async addAttachment(
    type: EntityType,
    id: number,
    filePath: string,
    description?: string
  ) {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");

    const item = await this.get(type, id);
    const fileBuffer = await readFile(filePath);
    const fileName = basename(filePath);

    const form = new FormData();
    form.append("object_id", String(id));
    form.append("project", String(item.project));
    if (description) form.append("description", description);
    form.append("attached_file", new Blob([fileBuffer]), fileName);

    const { data } = await this.requestRaw(`/${ENTITY_ENDPOINT[type]}/attachments`, {
      method: "POST",
      body: form,
    });
    return data;
  }

  /** Removes an attachment previously added with addAttachment. */
  async deleteAttachment(type: EntityType, attachmentId: number) {
    return this.request<void>(`/${ENTITY_ENDPOINT[type]}/attachments/${attachmentId}`, {
      method: "DELETE",
    });
  }
}
