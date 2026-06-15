#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Config ────────────────────────────────────────────────────────────────

const APP_ID = process.env.APPSHEET_APP_ID ?? "d39f2089-f7d8-4177-a068-321b1174a305";
const ACCESS_KEY = process.env.APPSHEET_ACCESS_KEY ?? "";
const BASE_URL = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables`;

const ALL_TABLES = [
  "Projects", "Tasks", "People", "Comments", "TimeEntries",
  "Enterprises", "Missions", "Initiatives",
  "PTO_Requests", "PTO_Policy", "Resources",
  "OrgHolidays", "CalendarEvents", "TimeFacts",
] as const;

type TableName = typeof ALL_TABLES[number];
// Fix 1.1: Resources added — it is read-only (no write use case)
const READ_ONLY_TABLES: TableName[] = ["TimeFacts", "PTO_Policy", "OrgHolidays", "Resources"];

// ─── AppSheet API helper ────────────────────────────────────────────────────

async function appsheetAction(
  table: string,
  action: "Find" | "Add" | "Edit" | "Delete",
  rows: Record<string, unknown>[] = [],
  properties: Record<string, unknown> = {}
): Promise<unknown> {
  if (!ACCESS_KEY) {
    throw new Error("APPSHEET_ACCESS_KEY is not set. Check your .env file.");
  }

  const response = await fetch(`${BASE_URL}/${table}/Action`, {
    method: "POST",
    headers: {
      ApplicationAccessKey: ACCESS_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Action: action, Properties: properties, Rows: rows }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AppSheet API ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function guardWritable(table: string) {
  if (READ_ONLY_TABLES.includes(table as TableName)) {
    throw new Error(`"${table}" is read-only and cannot be written to.`);
  }
}

function nowIso(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

function buildSelector(table: string, filters: string[]): string {
  if (filters.length === 0) return "";
  if (filters.length === 1) return `Filter(${table}, ${filters[0]})`;
  return `Filter(${table}, AND(${filters.join(", ")}))`;
}

// ─── Tool definitions ───────────────────────────────────────────────────────

const tools: Tool[] = [

  // ── Generic CRUD ──────────────────────────────────────────────────────────
  {
    name: "find_records",
    description: `Query records from any Manna Family AppSheet table.

Available tables: Projects, Tasks, People, Comments, TimeEntries, Enterprises, Missions, Initiatives, PTO_Requests, PTO_Policy, Resources, OrgHolidays, CalendarEvents, TimeFacts

Use selector for filtering with AppSheet expressions:
  - All records: omit selector
  - By field value: Filter(Tasks, [Status] = "In Progress")
  - By Ref key: Filter(Tasks, [AssigneeEmail] = "1WJL371ol74AqTdx-Uk_87")
  - By date range: Filter(TimeEntries, AND([CreatedAt] >= "2024-01-01", [CreatedAt] <= "2024-12-31"))
  - By project: Filter(Tasks, [ProjectID] = "<exact-id-from-get_projects>")

NOTE on Ref columns: AppSheet Ref columns store the key of the referenced table.
  - Tasks.AssigneeEmail → People: stored value IS the person's Row ID (not their email address)
  - Tasks.ProjectID → Projects: stored value is the exact ProjectID (use get_projects to find it)`,
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", enum: [...ALL_TABLES], description: "Table name (case-sensitive)" },
        selector: { type: "string", description: "AppSheet filter expression (optional). Leave empty to get all records." },
      },
      required: ["table"],
    },
  },
  {
    name: "get_record",
    description: "Fetch a single record by its primary key value.\n\nKey columns: Projects→ProjectID, Tasks→TaskID, People→Email, Comments→CommentID, TimeEntries→TimeEntryID, PTO_Requests→RequestID, Enterprises→EnterpriseID, Missions→MissionID, Initiatives→InitiativeID, CalendarEvents→EventKey, OrgHolidays→Holiday, Resources→Name, PTO_Policy→Position, TimeFacts→TimeFactKey",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", enum: [...ALL_TABLES] },
        key_column: { type: "string", description: "Primary key column name" },
        key_value: { type: "string", description: "The key value to look up" },
      },
      required: ["table", "key_column", "key_value"],
    },
  },
  {
    name: "create_record",
    description: `Add a new record to any writable table.

Column notes:
  - Tasks: key=TaskID, required: TaskName, CreatedBy
      · AssigneeEmail → People (pass email), ProjectID → Projects (pass exact ID from get_projects)
      · Priority column is spelled "Prority" (typo — must match exactly)
      · Repeat? values: No, Daily, Weekly, Bi-Weekly, Monthly
  - TimeEntries: key=TimeEntryID, required: TaskID, DurationMinutes, CreatedBy, Method (Manual|Timer)
  - Projects: key=ProjectID, required: ProjectName, CreatedBy
  - PTO_Requests: key=RequestID, required: Requester (email), Type, StartDate, EndDate, DayCount
  - Comments: key=CommentID, required: TaskID, CommentText, AddedBy (email)
  - People: key=Email, required: UserName, Role (Admin|User)

Read-only — never write: TimeFacts, PTO_Policy, OrgHolidays, Resources`,
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", enum: [...ALL_TABLES] },
        data: { type: "object", description: "Column names and values. For Ref columns pass the referenced table's key value.", additionalProperties: true },
      },
      required: ["table", "data"],
    },
  },
  {
    name: "update_record",
    description: "Update fields on an existing record. The primary key column must be included in the updates object.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", enum: [...ALL_TABLES] },
        key_column: { type: "string", description: "Primary key column name (e.g. TaskID, ProjectID, Email)" },
        key_value: { type: "string", description: "Current primary key value of the record to update" },
        updates: { type: "object", description: "Columns and new values to set.", additionalProperties: true },
      },
      required: ["table", "key_column", "key_value", "updates"],
    },
  },
  {
    name: "delete_record",
    description: "Delete a record from a writable table by its primary key.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", enum: [...ALL_TABLES] },
        key_column: { type: "string" },
        key_value: { type: "string" },
      },
      required: ["table", "key_column", "key_value"],
    },
  },

  // ── High-level convenience tools ─────────────────────────────────────────
  {
    name: "find_person",
    description: `Look up a person in the People table by name or email. Use this FIRST when:
  - The user refers to someone by name (e.g. "Jair", "Sarah") and you need their email
  - You need to resolve a name to an email before calling get_my_tasks, create_task, log_time, etc.

People.Email is the primary key used in all Ref columns referencing People
(Tasks.AssigneeEmail, Comments.AddedBy, PTO_Requests.Requester).`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or email to search for" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_projects",
    description: `List projects from the Projects table. Use this:
  - BEFORE creating a task — shows the user available projects and returns the exact ProjectID
  - To answer "what projects do we have?"
  - To find a specific project by name or status

The ProjectID returned here is the exact value to pass to create_task's project_id.
Status values: Active, On Hold, Completed`,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["Active", "On Hold", "Completed"], description: "Filter by status (optional)" },
        name_search: { type: "string", description: "Partial project name to search for (optional)" },
      },
      required: [],
    },
  },
  {
    name: "create_task",
    description: `Create a new task in the Manna Family app.

BEFORE calling this tool you MUST have:
  1. The user's email for created_by — if unknown, ask: "What is your email address?"
  2. A valid ProjectID — call get_projects first, show the list, let the user pick.
     NEVER guess or fabricate a ProjectID.

STEP-BY-STEP:
  a. Ask for user email if not known
  b. Call get_projects if user wants to link a project
  c. Confirm project with user, use exact ProjectID from get_projects
  d. Call create_task with all confirmed values

IMPORTANT: AssigneeEmail → People. Pass email. Use find_person if you only have a name.
IMPORTANT: ProjectID may be a UUID — never invent one. Always get it from get_projects.`,
    inputSchema: {
      type: "object",
      properties: {
        task_name: { type: "string" },
        created_by: { type: "string", description: "Email of creator (People.Email). Ask if unknown." },
        project_id: { type: "string", description: "Exact ProjectID from get_projects — never guess" },
        assignee_email: { type: "string", description: "Email to assign to (Ref → People)" },
        due_date: { type: "string", description: "Due date YYYY-MM-DD (optional)" },
        priority: { type: "string", enum: ["High", "Medium", "Low"], description: "Column is spelled 'Prority' internally (AppSheet typo)" },
        status: { type: "string", enum: ["To Do", "In Progress", "Blocked", "Completed"], description: "Defaults to To Do" },
        task_id: { type: "string", description: "Custom TaskID (optional — AppSheet auto-assigns if omitted)" },
        repeat: { type: "string", enum: ["No", "Daily", "Weekly", "Bi-Weekly", "Monthly"], description: "Recurring schedule (optional)" },
        mission_id: { type: "string", description: "MissionID to link to a mission (optional)" },
        task_type: { type: "string", description: "Task type tag from Task Type column (optional)" },
      },
      required: ["task_name", "created_by"],
    },
  },
  {
    name: "log_time",
    description: `Log a time entry against a task. Use for:
  - "Log 2 hours on the website task"
  - "I spent 45 minutes on T023"
  - "Add a time entry: 1.5 hours building the dashboard"

duration_minutes is required. start_at/end_at default to now if omitted.
If you only have a task name (not a TaskID), call find_records on Tasks first:
  Filter(Tasks, CONTAINS(LOWER([TaskName]), LOWER("website")))`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "TaskID. Use find_records on Tasks if you only have the task name." },
        duration_minutes: { type: "number", description: "Total minutes worked" },
        description: { type: "string", description: "What was done" },
        created_by: { type: "string", description: "Email of person logging time (People.Email). Ask if unknown." },
        start_at: { type: "string", description: "Start datetime YYYY-MM-DD HH:MM:SS (optional)" },
        end_at: { type: "string", description: "End datetime YYYY-MM-DD HH:MM:SS (optional)" },
      },
      required: ["task_id", "duration_minutes", "created_by"],
    },
  },
  {
    name: "get_my_tasks",
    description: `Get tasks assigned to a specific person. Use for:
  - "What are my open tasks?"
  - "Show all in-progress tasks for jair@wearemanna.org"
  - "What's on Sarah's plate?"
  - "My tasks on the Manna Workflow Tools project"

If you only have a name, call find_person first to get their email.
project_id is optional — use get_projects to find the correct ID.`,
    inputSchema: {
      type: "object",
      properties: {
        assignee_email: { type: "string", description: "Email of the person (People.Email)" },
        status: { type: "string", enum: ["To Do", "In Progress", "Blocked", "Completed"], description: "Filter by status (optional)" },
        project_id: { type: "string", description: "Filter by ProjectID (optional — use get_projects to find it)" },
      },
      required: ["assignee_email"],
    },
  },
  {
    name: "complete_task",
    description: `Mark a task as Completed. Use for:
  - "Mark task T023 as done"
  - "Complete the budget review task"`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "TaskID to mark complete" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "update_task_status",
    description: `Change the status of a task. Use for:
  - "Move task T023 to In Progress"
  - "Block task T044"
  - "Set T012 back to To Do"

Status values: To Do, In Progress, Blocked, Completed
Setting Completed also stamps CompletedAt automatically.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "TaskID to update" },
        status: { type: "string", enum: ["To Do", "In Progress", "Blocked", "Completed"] },
      },
      required: ["task_id", "status"],
    },
  },
  {
    name: "add_comment",
    description: `Add a comment to a task. Use for:
  - "Add a comment to T023: reviewed and approved"
  - "Comment on the budget task: waiting on finance"
  - "Leave a note on task T044"

added_by must be the commenter's email (Ref → People). Ask if unknown.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "TaskID to comment on" },
        comment_text: { type: "string", description: "The comment content" },
        added_by: { type: "string", description: "Email of commenter (People.Email). Ask if unknown." },
      },
      required: ["task_id", "comment_text", "added_by"],
    },
  },
  {
    name: "get_task_detail",
    description: `Get full detail for a task: the task record + all its comments + all time entries, in one call. Use for:
  - "Tell me everything about task T023"
  - "What's the status, comments, and time logged on T044?"
  - "Give me a full summary of the budget review task"

If you only have a task name, use find_records on Tasks first to get the TaskID.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "TaskID (e.g. T023)" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_pto_balance",
    description: `Get a person's current PTO balance from the People table. Use for:
  - "What's my PTO balance?"
  - "How many vacation days does Sarah have left?"

Returns: PTO_Balance_Current, PTO_Accrued_YTD, PTO_Used_YTD, AnnualPTO_AdjustedDays, CarryoverPTO_ThisYear`,
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address of the person (People.Email)" },
      },
      required: ["email"],
    },
  },
  {
    name: "get_time_report",
    description: `Get a time summary from TimeFacts (read-only aggregate table). Use for:
  - "How many hours did I log this week?"
  - "Show me time by project for March"
  - "What's the team's time on MBC?"
  - "Show me time for the week of March 10" → use week_start

All filters are optional — omit any you don't need.`,
    inputSchema: {
      type: "object",
      properties: {
        user_email: { type: "string", description: "Filter by user email" },
        project_name: { type: "string", description: "Filter by project name (partial match)" },
        enterprise_name: { type: "string", description: "Filter by enterprise name" },
        from_date: { type: "string", description: "Start date YYYY-MM-DD" },
        to_date: { type: "string", description: "End date YYYY-MM-DD" },
        week_start: { type: "string", description: "Exact week start date YYYY-MM-DD (matches TimeFacts.WeekStart grouping column)" },
      },
      required: [],
    },
  },
  {
    name: "get_team_workload",
    description: `Get all open tasks across the team. Use for:
  - "Who has the most open tasks?"
  - "Show me the team's current workload"
  - "What tasks are currently blocked?"
  - "Team status overview"

Returns all non-Completed tasks unless status is specified.
Claude should group results by AssigneeEmail to show per-person workload.`,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["To Do", "In Progress", "Blocked"], description: "Filter to a specific open status (optional)" },
        project_id: { type: "string", description: "Filter by ProjectID (optional)" },
      },
      required: [],
    },
  },
  {
    name: "submit_pto_request",
    description: `Submit a PTO / time-off request. Use for:
  - "Request 3 days of PTO from March 15 to March 17"
  - "Submit a sick day for tomorrow"
  - "I need comp time for travel days last week"

Types: PTO, CompTime, Sick, Unpaid
Requester → People (pass email). For CompTime, include comp_time_travel_days if user mentions travel days.`,
    inputSchema: {
      type: "object",
      properties: {
        requester_email: { type: "string", description: "Email of requester (People.Email)" },
        type: { type: "string", enum: ["PTO", "CompTime", "Sick", "Unpaid"] },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        day_count: { type: "number", description: "Number of days (0.5 for half day)" },
        reason: { type: "string", description: "Reason (optional)" },
        emergency: { type: "boolean", description: "Mark as emergency PTO (optional)" },
        half_portion: { type: "string", enum: ["Morning", "Afternoon"], description: "For half-day requests" },
        comp_time_travel_days: { type: "number", description: "Travel days for CompTime requests (optional)" },
        request_id: { type: "string", description: "Custom RequestID (optional)" },
      },
      required: ["requester_email", "type", "start_date", "end_date", "day_count"],
    },
  },
  {
    name: "get_org_context",
    description: `Get information about the organization's Enterprises. Use for:
  - "What enterprises does Manna have?"
  - "Tell me about MBC"
  - "Show me the org structure"

Enterprises: MBC, MGM, EP. Each has a VisionStatement and EnterpriseProfile.
To see missions under an enterprise, use find_records on Missions filtered by EnterpriseID.`,
    inputSchema: {
      type: "object",
      properties: {
        enterprise_name: { type: "string", description: "Partial enterprise name to search for (optional — omit for all)" },
      },
      required: [],
    },
  },
  {
    name: "get_holidays",
    description: `Get organizational holidays from OrgHolidays. Use for:
  - "What holidays are coming up?"
  - "Is March 17 a company holiday?"
  - "Show me all holidays this year"`,
    inputSchema: {
      type: "object",
      properties: {
        from_date: { type: "string", description: "Start date YYYY-MM-DD (optional)" },
        to_date: { type: "string", description: "End date YYYY-MM-DD (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_pto_policy",
    description: `Get PTO policy rules by position level. Use for:
  - "How many PTO days does a Supervisor get?"
  - "What's the PTO policy for entry-level staff?"
  - "Show me the full PTO policy table"

Position values: Staff/Non-Professional, Entry Level Professional, Advanced Professional, Supervisor, Director, Senior Director`,
    inputSchema: {
      type: "object",
      properties: {
        position: { type: "string", description: "Exact position level (optional — omit for full policy table)" },
      },
      required: [],
    },
  },
  {
    name: "get_calendar_events",
    description: `Get calendar events synced from Google Calendar. Use for:
  - "What's on my calendar this week?"
  - "Show me events for jair from March 10 to March 17"
  - "What calendar events are linked to a specific project?"

All filters are optional.`,
    inputSchema: {
      type: "object",
      properties: {
        user_email: { type: "string", description: "Filter by event owner's email" },
        from_date: { type: "string", description: "Filter events starting on or after this date YYYY-MM-DD" },
        to_date: { type: "string", description: "Filter events starting on or before this date YYYY-MM-DD" },
        project_id: { type: "string", description: "Filter by AI-suggested ProjectID_Suggested (optional)" },
      },
      required: [],
    },
  },
];

// ─── Tool handlers ──────────────────────────────────────────────────────────

async function handleFindRecords(args: { table: string; selector?: string }) {
  const properties: Record<string, unknown> = {};
  if (args.selector) properties.Selector = args.selector;
  return appsheetAction(args.table, "Find", [], properties);
}

async function handleGetRecord(args: { table: string; key_column: string; key_value: string }) {
  return appsheetAction(args.table, "Find", [{ [args.key_column]: args.key_value }]);
}

async function handleCreateRecord(args: { table: string; data: Record<string, unknown> }) {
  guardWritable(args.table);
  return appsheetAction(args.table, "Add", [args.data]);
}

async function handleUpdateRecord(args: {
  table: string; key_column: string; key_value: string; updates: Record<string, unknown>;
}) {
  guardWritable(args.table);
  const row = { [args.key_column]: args.key_value, ...args.updates };
  return appsheetAction(args.table, "Edit", [row]);
}

async function handleDeleteRecord(args: { table: string; key_column: string; key_value: string }) {
  guardWritable(args.table);
  return appsheetAction(args.table, "Delete", [{ [args.key_column]: args.key_value }]);
}

async function handleFindPerson(args: { query: string }) {
  const isEmail = args.query.includes("@");
  const selector = isEmail
    ? `Filter(People, [Email] = "${args.query}")`
    : `Filter(People, CONTAINS(LOWER([UserName]), LOWER("${args.query}")))`;
  return appsheetAction("People", "Find", [], { Selector: selector });
}

async function handleGetProjects(args: { status?: string; name_search?: string }) {
  const filters: string[] = [];
  if (args.status) filters.push(`[Status] = "${args.status}"`);
  if (args.name_search) filters.push(`CONTAINS(LOWER([ProjectName]), LOWER("${args.name_search}"))`);
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("Projects", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("Projects", "Find", [], properties);
}

async function handleCreateTask(args: {
  task_name: string; created_by: string; project_id?: string;
  assignee_email?: string; due_date?: string; priority?: string;
  status?: string; task_id?: string; repeat?: string;
  mission_id?: string; task_type?: string;
}) {
  const row: Record<string, unknown> = {
    TaskName: args.task_name,
    Status: args.status ?? "To Do",
    CreatedBy: args.created_by,
    CreatedAt: nowIso(),
  };
  if (args.task_id)       row.TaskID        = args.task_id;
  if (args.project_id)    row.ProjectID     = args.project_id;
  if (args.assignee_email) row.AssigneeEmail = args.assignee_email;
  if (args.due_date)      row.DueDate       = args.due_date;
  if (args.priority)      row.Prority       = args.priority; // AppSheet typo preserved
  if (args.repeat)        row["Repeat?"]    = args.repeat;
  if (args.mission_id)    row.MissionName   = args.mission_id;
  if (args.task_type)     row["Task Type"]  = args.task_type;
  return appsheetAction("Tasks", "Add", [row]);
}

async function handleLogTime(args: {
  task_id: string; duration_minutes: number; description?: string;
  created_by: string; start_at?: string; end_at?: string;
}) {
  const now = new Date();
  const endAt = args.end_at ?? nowIso();
  const startAt = args.start_at ?? new Date(now.getTime() - args.duration_minutes * 60_000)
    .toISOString().replace("T", " ").substring(0, 19);
  const timeEntryId = `TE${Date.now().toString().slice(-8)}`;
  return appsheetAction("TimeEntries", "Add", [{
    TimeEntryID: timeEntryId,
    TaskID: args.task_id,
    EntryDescription: args.description ?? "",
    StartAt: startAt,
    EndAt: endAt,
    DurationMinutes: args.duration_minutes,
    CreatedAt: endAt,
    CreatedBy: args.created_by,
    Method: "Manual",
  }]);
}

async function handleGetMyTasks(args: { assignee_email: string; status?: string; project_id?: string }) {
  const peopleResult = (await handleFindPerson({ query: args.assignee_email })) as Record<string, unknown>[];
  if (!Array.isArray(peopleResult) || peopleResult.length === 0) {
    throw new Error(`Could not find person with email: ${args.assignee_email}`);
  }
  
  const person = peopleResult[0];
  const rowId = person["Row ID"];
  if (!rowId) {
    throw new Error(`Could not find Row ID for person with email: ${args.assignee_email}`);
  }

  const filters = [`[AssigneeEmail] = "${rowId}"`];
  if (args.status)     filters.push(`[Status] = "${args.status}"`);
  if (args.project_id) filters.push(`[ProjectID] = "${args.project_id}"`);
  return appsheetAction("Tasks", "Find", [], { Selector: buildSelector("Tasks", filters) });
}

async function handleCompleteTask(args: { task_id: string }) {
  return appsheetAction("Tasks", "Edit", [{
    TaskID: args.task_id,
    Status: "Completed",
    CompletedAt: nowIso(),
  }]);
}

async function handleUpdateTaskStatus(args: { task_id: string; status: string }) {
  const row: Record<string, unknown> = { TaskID: args.task_id, Status: args.status };
  if (args.status === "Completed") row.CompletedAt = nowIso();
  return appsheetAction("Tasks", "Edit", [row]);
}

async function handleAddComment(args: { task_id: string; comment_text: string; added_by: string }) {
  const commentId = `C${Date.now().toString().slice(-8)}`;
  return appsheetAction("Comments", "Add", [{
    CommentID: commentId,
    TaskID: args.task_id,
    CommentText: args.comment_text,
    AddedBy: args.added_by,
    CreatedAt: nowIso(),
  }]);
}

async function handleGetTaskDetail(args: { task_id: string }) {
  const taskSel    = `Filter(Tasks,       [TaskID] = "${args.task_id}")`;
  const commentSel = `Filter(Comments,    [TaskID] = "${args.task_id}")`;
  const timeSel    = `Filter(TimeEntries, [TaskID] = "${args.task_id}")`;
  const [task, comments, timeEntries] = await Promise.all([
    appsheetAction("Tasks",       "Find", [], { Selector: taskSel }),
    appsheetAction("Comments",    "Find", [], { Selector: commentSel }),
    appsheetAction("TimeEntries", "Find", [], { Selector: timeSel }),
  ]);
  return { task, comments, timeEntries };
}

async function handleGetPtoBalance(args: { email: string }) {
  const selector = `Filter(People, [Email] = "${args.email}")`;
  return appsheetAction("People", "Find", [], { Selector: selector });
}

async function handleGetTimeReport(args: {
  user_email?: string; project_name?: string; enterprise_name?: string;
  from_date?: string; to_date?: string; week_start?: string;
}) {
  const filters: string[] = [];
  if (args.user_email)      filters.push(`[UserEmail] = "${args.user_email}"`);
  if (args.project_name)    filters.push(`CONTAINS([ProjectName], "${args.project_name}")`);
  if (args.enterprise_name) filters.push(`CONTAINS([EnterpriseName], "${args.enterprise_name}")`);
  if (args.from_date)       filters.push(`[Date] >= "${args.from_date}"`);
  if (args.to_date)         filters.push(`[Date] <= "${args.to_date}"`);
  if (args.week_start)      filters.push(`[WeekStart] = "${args.week_start}"`);
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("TimeFacts", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("TimeFacts", "Find", [], properties);
}

async function handleGetTeamWorkload(args: { status?: string; project_id?: string }) {
  const filters: string[] = [];
  if (args.status) {
    filters.push(`[Status] = "${args.status}"`);
  } else {
    filters.push(`IN([Status], {"To Do", "In Progress", "Blocked"})`);
  }
  if (args.project_id) filters.push(`[ProjectID] = "${args.project_id}"`);
  return appsheetAction("Tasks", "Find", [], { Selector: buildSelector("Tasks", filters) });
}

async function handleSubmitPtoRequest(args: {
  requester_email: string; type: string; start_date: string;
  end_date: string; day_count: number; reason?: string;
  emergency?: boolean; half_portion?: string;
  comp_time_travel_days?: number; request_id?: string;
}) {
  const requestId = args.request_id ?? `PTO${Date.now().toString().slice(-8)}`;
  return appsheetAction("PTO_Requests", "Add", [{
    RequestID: requestId,
    Requester: args.requester_email,
    Type: args.type,
    StartDate: args.start_date,
    EndDate: args.end_date,
    DayCount: args.day_count,
    SubmittedAt: nowIso(),
    Status: "Submitted",
    ...(args.reason                 && { Reason: args.reason }),
    ...(args.emergency !== undefined && { Emergency: args.emergency }),
    ...(args.half_portion           && { HalfPortion: args.half_portion }),
    ...(args.comp_time_travel_days !== undefined && { CompTime_TravelDays: args.comp_time_travel_days }),
  }]);
}

async function handleGetOrgContext(args: { enterprise_name?: string }) {
  const properties: Record<string, unknown> = {};
  if (args.enterprise_name) {
    properties.Selector = `Filter(Enterprises, CONTAINS(LOWER([EnterpriseName]), LOWER("${args.enterprise_name}")))`;
  }
  return appsheetAction("Enterprises", "Find", [], properties);
}

async function handleGetHolidays(args: { from_date?: string; to_date?: string }) {
  const filters: string[] = [];
  if (args.from_date) filters.push(`[Date] >= "${args.from_date}"`);
  if (args.to_date)   filters.push(`[Date] <= "${args.to_date}"`);
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("OrgHolidays", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("OrgHolidays", "Find", [], properties);
}

async function handleGetPtoPolicy(args: { position?: string }) {
  const properties: Record<string, unknown> = {};
  if (args.position) {
    properties.Selector = `Filter(PTO_Policy, [Position] = "${args.position}")`;
  }
  return appsheetAction("PTO_Policy", "Find", [], properties);
}

async function handleGetCalendarEvents(args: {
  user_email?: string; from_date?: string; to_date?: string; project_id?: string;
}) {
  const filters: string[] = [];
  if (args.user_email)  filters.push(`[UserEmail] = "${args.user_email}"`);
  if (args.from_date)   filters.push(`[StartAt] >= "${args.from_date}"`);
  if (args.to_date)     filters.push(`[StartAt] <= "${args.to_date}"`);
  if (args.project_id)  filters.push(`[ProjectID_Suggested] = "${args.project_id}"`);
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("CalendarEvents", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("CalendarEvents", "Find", [], properties);
}

// ─── Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: "manna-family-appsheet", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;

    switch (name) {
      case "find_records":        result = await handleFindRecords(a as never); break;
      case "get_record":          result = await handleGetRecord(a as never); break;
      case "create_record":       result = await handleCreateRecord(a as never); break;
      case "update_record":       result = await handleUpdateRecord(a as never); break;
      case "delete_record":       result = await handleDeleteRecord(a as never); break;
      case "find_person":         result = await handleFindPerson(a as never); break;
      case "get_projects":        result = await handleGetProjects(a as never); break;
      case "create_task":         result = await handleCreateTask(a as never); break;
      case "log_time":            result = await handleLogTime(a as never); break;
      case "get_my_tasks":        result = await handleGetMyTasks(a as never); break;
      case "complete_task":       result = await handleCompleteTask(a as never); break;
      case "update_task_status":  result = await handleUpdateTaskStatus(a as never); break;
      case "add_comment":         result = await handleAddComment(a as never); break;
      case "get_task_detail":     result = await handleGetTaskDetail(a as never); break;
      case "get_pto_balance":     result = await handleGetPtoBalance(a as never); break;
      case "get_time_report":     result = await handleGetTimeReport(a as never); break;
      case "get_team_workload":   result = await handleGetTeamWorkload(a as never); break;
      case "submit_pto_request":  result = await handleSubmitPtoRequest(a as never); break;
      case "get_org_context":     result = await handleGetOrgContext(a as never); break;
      case "get_holidays":        result = await handleGetHolidays(a as never); break;
      case "get_pto_policy":      result = await handleGetPtoPolicy(a as never); break;
      case "get_calendar_events": result = await handleGetCalendarEvents(a as never); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  if (!ACCESS_KEY) {
    console.error("❌ APPSHEET_ACCESS_KEY is not set. Create a .env file — see .env.example");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Manna Family AppSheet MCP Server running (v1.1.0)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
