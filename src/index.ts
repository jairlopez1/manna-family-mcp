#!/usr/bin/env node
import { execSync } from "child_process";
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

let cachedUserEmail: string | null | undefined = undefined;

function getCurrentUserEmail(): string | null {
  if (cachedUserEmail !== undefined) return cachedUserEmail;
  for (const cmd of ["git config --global user.email", "git config user.email"]) {
    try {
      const email = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (email && email.includes("@")) {
        cachedUserEmail = email;
        return email;
      }
    } catch {
      // try next
    }
  }
  cachedUserEmail = null;
  return null;
}

const ALL_TABLES = [
  "Projects", "Tasks", "People", "Comments", "TimeEntries",
  "Enterprises", "Missions", "Initiatives",
  "PTO_Requests", "PTO_Policy", "Resources",
  "OrgHolidays", "CalendarEvents", "TimeFacts",
  "Rocks", "VisionPictures",
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

Available tables: Projects, Tasks, People, Comments, TimeEntries, Enterprises, Missions, Initiatives, PTO_Requests, PTO_Policy, Resources, OrgHolidays, CalendarEvents, TimeFacts, Rocks, VisionPictures

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
    name: "get_current_user",
    description: "Retrieve the email and database profile of the current user based on Git configuration. ALWAYS call this at the start of every conversation. If it returns no email, immediately ask the user: 'What is your work email (@wearemanna.org)?' before doing anything else. Never assume or default to another person's email.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "start_timer",
    description: "Start a time tracking timer on a specific task. Throws an error if there is already an active running timer.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The TaskID to start the timer on" },
        description: { type: "string", description: "What you are working on (optional)" },
        created_by: { type: "string", description: "Email of the person starting the timer. Defaults to current user if omitted." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "stop_timer",
    description: "Stop the active running timer for the current user and calculate the elapsed duration.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Stop the timer for this specific TaskID (optional). If omitted, stops the user's active timer." },
        description: { type: "string", description: "Update/set the description of what was done (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_daily_digest",
    description: "Retrieve a summary of the user's day: open tasks, today's schedule, and hours logged today.",
    inputSchema: {
      type: "object",
      properties: {
        user_email: { type: "string", description: "Filter digest by email. Defaults to current user if omitted." },
      },
      required: [],
    },
  },
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

IMPORTANT: AssigneeEmail → People. Pass email or name. Use find_person if you only have a name.
IMPORTANT: ProjectID may be a UUID — never invent one. Always get it from get_projects.`,
    inputSchema: {
      type: "object",
      properties: {
        task_name: { type: "string" },
        created_by: { type: "string", description: "Email of creator (People.Email). Defaults to current user if omitted." },
        project_id: { type: "string", description: "Exact ProjectID from get_projects — never guess" },
        assignee_email: { type: "string", description: "Email or name to assign to (Ref → People)" },
        due_date: { type: "string", description: "Due date YYYY-MM-DD (optional)" },
        priority: { type: "string", enum: ["High", "Medium", "Low"], description: "Column is spelled 'Prority' internally (AppSheet typo)" },
        status: { type: "string", enum: ["To Do", "In Progress", "Blocked", "Completed"], description: "Defaults to To Do" },
        task_id: { type: "string", description: "Custom TaskID (optional — AppSheet auto-assigns if omitted)" },
        repeat: { type: "string", enum: ["No", "Daily", "Weekly", "Bi-Weekly", "Monthly"], description: "Recurring schedule (optional)" },
        mission_id: { type: "string", description: "MissionID to link to a mission (optional)" },
        task_type: { type: "string", description: "Task type tag from Task Type column (optional)" },
      },
      required: ["task_name"],
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
        created_by: { type: "string", description: "Email of person logging time (People.Email). Defaults to current user if omitted." },
        start_at: { type: "string", description: "Start datetime YYYY-MM-DD HH:MM:SS (optional)" },
        end_at: { type: "string", description: "End datetime YYYY-MM-DD HH:MM:SS (optional)" },
      },
      required: ["task_id", "duration_minutes"],
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
        assignee_email: { type: "string", description: "Email of the person (People.Email). Defaults to current user if omitted." },
        status: { type: "string", enum: ["To Do", "In Progress", "Blocked", "Completed"], description: "Filter by status (optional)" },
        project_id: { type: "string", description: "Filter by ProjectID (optional — use get_projects to find it)" },
      },
      required: [],
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
        email: { type: "string", description: "Email address of the person (People.Email). Defaults to current user if omitted." },
      },
      required: [],
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
        requester_email: { type: "string", description: "Email of requester (People.Email). Defaults to current user if omitted." },
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
      required: ["type", "start_date", "end_date", "day_count"],
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
    name: "get_active_timer",
    description: "Check if the current user (or a specified user) has a running timer. Returns the active timer entry or null if none is running.",
    inputSchema: {
      type: "object",
      properties: {
        created_by: { type: "string", description: "Email to check. Defaults to current user if omitted." },
      },
      required: [],
    },
  },
  {
    name: "search_tasks",
    description: `Search tasks by name keyword. Use for:
  - "Find the website task"
  - "Search for tasks about budget"
  - "Is there a task called onboarding?"

Returns matching tasks regardless of status or assignee. Optionally filter by status or assignee.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or phrase to search in task names" },
        status: { type: "string", enum: ["To Do", "In Progress", "Blocked", "Completed"], description: "Filter by status (optional)" },
        assignee_email: { type: "string", description: "Filter by assignee email or name (optional)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_overdue_tasks",
    description: `Get tasks that are past their due date and not yet completed. Use for:
  - "What tasks are overdue?"
  - "Show me everything that's past due"
  - "What's late on the team?"

Optionally filter by assignee or project.`,
    inputSchema: {
      type: "object",
      properties: {
        assignee_email: { type: "string", description: "Filter by assignee email or name (optional). Defaults to all team members." },
        project_id: { type: "string", description: "Filter by ProjectID (optional)" },
      },
      required: [],
    },
  },
  {
    name: "reassign_task",
    description: `Change the assignee of a task. Use for:
  - "Reassign T023 to Sarah"
  - "Move the budget task from Jair to Maria"

Resolves names to People Row IDs automatically.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "TaskID to reassign" },
        assignee_email: { type: "string", description: "New assignee email or name (Ref → People)" },
      },
      required: ["task_id", "assignee_email"],
    },
  },
  {
    name: "approve_pto_request",
    description: `Approve a PTO request (manager action). Use for:
  - "Approve PTO request PTO12345678"
  - "Approve Sarah's time-off request"`,
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "RequestID of the PTO request to approve" },
        reviewed_by: { type: "string", description: "Email of approving manager. Defaults to current user if omitted." },
        notes: { type: "string", description: "Optional notes or comments on the approval" },
      },
      required: ["request_id"],
    },
  },
  {
    name: "reject_pto_request",
    description: `Reject a PTO request (manager action). Use for:
  - "Reject PTO request PTO12345678"
  - "Deny Sarah's request — we're short staffed that week"`,
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "RequestID of the PTO request to reject" },
        reviewed_by: { type: "string", description: "Email of reviewing manager. Defaults to current user if omitted." },
        notes: { type: "string", description: "Reason for rejection (recommended)" },
      },
      required: ["request_id"],
    },
  },
  {
    name: "get_my_time_summary",
    description: `Get a rolled-up time summary for a user — total hours by project, for a given period. Use for:
  - "How many hours did I log this week?"
  - "Show me my time by project for June"
  - "What did I work on this month?"

Defaults to the current week if no dates are provided.`,
    inputSchema: {
      type: "object",
      properties: {
        user_email: { type: "string", description: "Filter by user email. Defaults to current user if omitted." },
        from_date: { type: "string", description: "Start date YYYY-MM-DD (optional, defaults to Monday of current week)" },
        to_date: { type: "string", description: "End date YYYY-MM-DD (optional, defaults to today)" },
      },
      required: [],
    },
  },
  {
    name: "get_weekly_digest",
    description: "Retrieve a summary of the user's current week: open tasks, this week's calendar events, and hours logged Mon–today. Useful for Friday reviews or Monday planning.",
    inputSchema: {
      type: "object",
      properties: {
        user_email: { type: "string", description: "Filter digest by email. Defaults to current user if omitted." },
      },
      required: [],
    },
  },
  {
    name: "get_missions",
    description: `Get missions (strategic objectives) from the Missions table. Use for:
  - "What are our current missions?"
  - "Show missions under MBC"
  - "List all active missions"

Missions link to Enterprises and can have tasks linked to them.`,
    inputSchema: {
      type: "object",
      properties: {
        enterprise_id: { type: "string", description: "Filter by EnterpriseID (optional)" },
        name_search: { type: "string", description: "Partial mission name to search for (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_initiatives",
    description: `Get initiatives from the Initiatives table. Use for:
  - "What initiatives are we running?"
  - "Show initiatives under Mission X"
  - "List all initiatives for MBC"

Initiatives sit below Missions in the org hierarchy.`,
    inputSchema: {
      type: "object",
      properties: {
        mission_id: { type: "string", description: "Filter by MissionID (optional)" },
        name_search: { type: "string", description: "Partial initiative name to search for (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_rocks",
    description: `Get Rocks (quarterly 90-day goals) from the Rocks table. Use for:
  - "What are our rocks this quarter?"
  - "Show rocks for MBC Q3 2026"
  - "What are Jair's rocks?"
  - "List all organizational rocks"

Rocks follow EOS (Entrepreneurial Operating System) methodology.
RockID format: R-{EnterpriseCode}-{Year}Q{Quarter}-{sequence}
Status values: On Track | Off Track | Done | Missed
Scope values: Organizational Rock | Individual Rock`,
    inputSchema: {
      type: "object",
      properties: {
        enterprise_id:   { type: "string", description: "Filter by EnterpriseID (optional)" },
        assignee_email:  { type: "string", description: "Filter by assignee email or name (optional)" },
        quarter:         { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"], description: "Filter by quarter (optional)" },
        year:            { type: "string", description: "Filter by year e.g. 2026 (optional)" },
        status:          { type: "string", enum: ["On Track", "Off Track", "Done", "Missed"], description: "Filter by status (optional)" },
        scope:           { type: "string", enum: ["Organizational Rock", "Individual Rock"], description: "Filter by scope (optional)" },
        name_search:     { type: "string", description: "Partial rock name to search for (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_rock_detail",
    description: `Get full detail for a specific Rock by its RockID. Use for:
  - "Tell me about rock R-EP-2026Q3-001"
  - "What's the success criteria for that rock?"`,
    inputSchema: {
      type: "object",
      properties: {
        rock_id: { type: "string", description: "RockID (e.g. R-EP-2026Q3-001)" },
      },
      required: ["rock_id"],
    },
  },
  {
    name: "get_overdue_rocks",
    description: `Get Rocks that are past their due date and not yet Done. Use for:
  - "What rocks are overdue?"
  - "Show past-due rocks for MBC"
  - "Which rocks did we miss?"`,
    inputSchema: {
      type: "object",
      properties: {
        enterprise_id:  { type: "string", description: "Filter by EnterpriseID (optional)" },
        assignee_email: { type: "string", description: "Filter by assignee email or name (optional)" },
      },
      required: [],
    },
  },
  {
    name: "create_rock",
    description: `Create a new Rock (quarterly goal). The RockID is generated server-side — never supply one.

BEFORE calling:
  1. Know the EnterpriseID — call list_enterprises if unsure
  2. Know the Quarter (Q1–Q4) and Year
  3. Know the assignee email if assigning to a person

Status defaults to "On Track". Scope defaults to "Individual Rock".`,
    inputSchema: {
      type: "object",
      properties: {
        rock_name:        { type: "string", description: "Name of the Rock" },
        enterprise_id:    { type: "string", description: "EnterpriseID this Rock belongs to" },
        quarter:          { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"], description: "Quarter (Q1–Q4)" },
        year:             { type: "string", description: "Year e.g. 2026" },
        scope:            { type: "string", enum: ["Organizational Rock", "Individual Rock"], description: "Defaults to Individual Rock" },
        assignee_email:   { type: "string", description: "Email or name of assignee (optional)" },
        mission_id:       { type: "string", description: "MissionID to link (optional)" },
        due_date:         { type: "string", description: "Due date YYYY-MM-DD (optional)" },
        success_criteria: { type: "string", description: "What does Done look like? (optional)" },
      },
      required: ["rock_name", "enterprise_id", "quarter", "year"],
    },
  },
  {
    name: "update_rock_status",
    description: `Update the status of a Rock. Use for:
  - "Mark rock R-EP-2026Q3-001 as Done"
  - "Set that rock to Off Track"
  - "We completed rock R-MBC-2026Q3-005"

Status values: On Track | Off Track | Done | Missed`,
    inputSchema: {
      type: "object",
      properties: {
        rock_id:        { type: "string", description: "RockID to update" },
        status:         { type: "string", enum: ["On Track", "Off Track", "Done", "Missed"] },
        updated_by:     { type: "string", description: "Email of person updating. Defaults to current user if omitted." },
      },
      required: ["rock_id", "status"],
    },
  },
  {
    name: "get_enterprise_vision",
    description: `Get the vision statement and vision pictures for one or all enterprises. Use for:
  - "What's the vision for MBC?"
  - "Show me our org vision"
  - "What does our vision picture look like for EP?"

Returns VisionStatement from Enterprises and any VisionPictures records.`,
    inputSchema: {
      type: "object",
      properties: {
        enterprise_id: { type: "string", description: "EnterpriseID (optional — omit for all enterprises)" },
      },
      required: [],
    },
  },
  {
    name: "list_enterprises",
    description: `List all enterprises with their IDs, names, and codes. Use this when you need an EnterpriseID for create_rock or filtering other tools.`,
    inputSchema: {
      type: "object",
      properties: {},
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
        user_email: { type: "string", description: "Filter by event owner's email. Defaults to current user if omitted." },
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

async function resolvePeopleRowId(queryOrEmail: string): Promise<string> {
  if (!queryOrEmail) return "";
  try {
    const people = await handleFindPerson({ query: queryOrEmail }) as Record<string, unknown>[];
    if (people && people.length > 0) {
      const rowId = people[0]["Row ID"] as string;
      if (rowId) return rowId;
    }
  } catch {
    // ignore
  }
  return queryOrEmail;
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
  task_name: string; created_by?: string; project_id?: string;
  assignee_email?: string; due_date?: string; priority?: string;
  status?: string; task_id?: string; repeat?: string;
  mission_id?: string; task_type?: string;
}) {
  const createdBy = args.created_by || getCurrentUserEmail();
  if (!createdBy) {
    throw new Error("created_by is required (and could not be automatically detected).");
  }
  const row: Record<string, unknown> = {
    TaskName: args.task_name,
    Status: args.status ?? "To Do",
    CreatedBy: createdBy,
    CreatedAt: nowIso(),
  };
  if (args.task_id)       row.TaskID        = args.task_id;
  if (args.project_id)    row.ProjectID     = args.project_id;
  if (args.assignee_email) {
    row.AssigneeEmail = await resolvePeopleRowId(args.assignee_email);
  }
  if (args.due_date)      row.DueDate       = args.due_date;
  if (args.priority)      row.Prority       = args.priority; // AppSheet typo preserved
  if (args.repeat)        row["Repeat?"]    = args.repeat;
  if (args.mission_id)    row.MissionName   = args.mission_id;
  if (args.task_type)     row["Task Type"]  = args.task_type;
  return appsheetAction("Tasks", "Add", [row]);
}

async function handleLogTime(args: {
  task_id: string; duration_minutes: number; description?: string;
  created_by?: string; start_at?: string; end_at?: string;
}) {
  const createdBy = args.created_by || getCurrentUserEmail();
  if (!createdBy) {
    throw new Error("created_by is required (and could not be automatically detected).");
  }
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
    CreatedBy: createdBy,
    Method: "Manual",
  }]);
}

async function handleGetMyTasks(args: { assignee_email?: string; status?: string; project_id?: string }) {
  const email = args.assignee_email || getCurrentUserEmail();
  if (!email) {
    throw new Error("assignee_email is required (and could not be automatically detected).");
  }
  const rowId = await resolvePeopleRowId(email);
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

async function handleGetPtoBalance(args: { email?: string }) {
  const email = args.email || getCurrentUserEmail();
  if (!email) {
    throw new Error("email is required (and could not be automatically detected).");
  }
  const selector = `Filter(People, [Email] = "${email}")`;
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
  requester_email?: string; type: string; start_date: string;
  end_date: string; day_count: number; reason?: string;
  emergency?: boolean; half_portion?: string;
  comp_time_travel_days?: number; request_id?: string;
}) {
  const requesterEmail = args.requester_email || getCurrentUserEmail();
  if (!requesterEmail) {
    throw new Error("requester_email is required (and could not be automatically detected).");
  }
  const requestId = args.request_id ?? `PTO${Date.now().toString().slice(-8)}`;
  return appsheetAction("PTO_Requests", "Add", [{
    RequestID: requestId,
    Requester: requesterEmail,
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
  const email = args.user_email || getCurrentUserEmail();
  const filters: string[] = [];
  if (email)            filters.push(`[UserEmail] = "${email}"`);
  if (args.from_date)   filters.push(`[StartAt] >= "${args.from_date}"`);
  if (args.to_date)     filters.push(`[StartAt] <= "${args.to_date}"`);
  if (args.project_id)  filters.push(`[ProjectID_Suggested] = "${args.project_id}"`);
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("CalendarEvents", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("CalendarEvents", "Find", [], properties);
}

async function handleGetCurrentUser() {
  const email = getCurrentUserEmail();
  if (!email) {
    return {
      email: null,
      profile: null,
      warning: "No work email detected. Git is not configured on this machine. Ask the user for their @wearemanna.org email before proceeding with any task."
    };
  }
  try {
    const people = await handleFindPerson({ query: email }) as Record<string, unknown>[];
    if (people && people.length > 0) {
      return { email, profile: people[0] };
    }
  } catch {
    // ignore
  }
  return { email, profile: null };
}

async function handleStartTimer(args: { task_id: string; description?: string; created_by?: string }) {
  const createdBy = args.created_by || getCurrentUserEmail();
  if (!createdBy) {
    throw new Error("created_by email is required (and could not be automatically detected).");
  }

  // Check if there's already an active running timer for this user
  const checkSel = `Filter(TimeEntries, AND([CreatedBy] = "${createdBy}", ISBLANK([EndAt])))`;
  const openTimers = await appsheetAction("TimeEntries", "Find", [], { Selector: checkSel }) as Record<string, unknown>[];
  if (Array.isArray(openTimers) && openTimers.length > 0) {
    throw new Error(`You already have a running timer on task "${openTimers[0].TaskID}". Stop it first.`);
  }

  const startAt = nowIso();
  const timeEntryId = `TE${Date.now().toString().slice(-8)}`;
  return appsheetAction("TimeEntries", "Add", [{
    TimeEntryID: timeEntryId,
    TaskID: args.task_id,
    EntryDescription: args.description ?? "",
    StartAt: startAt,
    EndAt: "",
    DurationMinutes: 0,
    CreatedAt: startAt,
    CreatedBy: createdBy,
    Method: "Timer",
  }]);
}

async function handleStopTimer(args: { task_id?: string; description?: string }) {
  const email = getCurrentUserEmail();
  if (!email) {
    throw new Error("Could not detect current user email to stop active timer.");
  }

  // Find the user's active timer
  const filters = [
    `[CreatedBy] = "${email}"`,
    `ISBLANK([EndAt])`
  ];
  if (args.task_id) {
    filters.push(`[TaskID] = "${args.task_id}"`);
  }

  const checkSel = buildSelector("TimeEntries", filters);
  const openTimers = await appsheetAction("TimeEntries", "Find", [], { Selector: checkSel }) as Record<string, unknown>[];
  if (!Array.isArray(openTimers) || openTimers.length === 0) {
    throw new Error("No active timer found to stop.");
  }

  const activeTimer = openTimers[0];
  const startAtStr = activeTimer.StartAt as string;
  
  // AppSheet date format is MM/DD/YYYY HH:MM:SS or YYYY-MM-DD HH:MM:SS. We need to normalize it for JS parsing.
  // Standard format from nowIso() is "YYYY-MM-DD HH:MM:SS" which JS Date can parse if we change space to 'T' or let JS parse it.
  const startAt = new Date(startAtStr.replace(" ", "T"));
  const now = new Date();
  
  let duration = 0;
  if (!isNaN(startAt.getTime())) {
    duration = Math.max(1, Math.round((now.getTime() - startAt.getTime()) / 60_000));
  }

  const updates: Record<string, unknown> = {
    TimeEntryID: activeTimer.TimeEntryID,
    EndAt: nowIso(),
    DurationMinutes: duration,
  };
  if (args.description !== undefined) {
    updates.EntryDescription = args.description;
  }

  return appsheetAction("TimeEntries", "Edit", [updates]);
}

async function handleGetDailyDigest(args: { user_email?: string }) {
  const email = args.user_email || getCurrentUserEmail();
  if (!email) {
    throw new Error("user_email is required (and could not be automatically detected).");
  }

  const rowId = await resolvePeopleRowId(email);
  const todayStr = new Date().toISOString().split("T")[0];

  // 1. Open tasks
  const taskSel = buildSelector("Tasks", [
    `[AssigneeEmail] = "${rowId}"`,
    `IN([Status], {"To Do", "In Progress", "Blocked"})`
  ]);

  // 2. Calendar events for today
  const eventSel = buildSelector("CalendarEvents", [
    `[UserEmail] = "${email}"`,
    `[StartAt] >= "${todayStr} 00:00:00"`,
    `[StartAt] <= "${todayStr} 23:59:59"`
  ]);

  // 3. Time logged today
  const timeSel = buildSelector("TimeEntries", [
    `[CreatedBy] = "${email}"`,
    `[StartAt] >= "${todayStr} 00:00:00"`
  ]);

  const [tasks, events, timeEntries] = await Promise.all([
    appsheetAction("Tasks", "Find", [], taskSel ? { Selector: taskSel } : {}),
    appsheetAction("CalendarEvents", "Find", [], eventSel ? { Selector: eventSel } : {}),
    appsheetAction("TimeEntries", "Find", [], timeSel ? { Selector: timeSel } : {})
  ]);

  return {
    user: { email, rowId },
    today: todayStr,
    open_tasks: tasks,
    today_events: events,
    today_time_entries: timeEntries
  };
}

async function handleGetActiveTimer(args: { created_by?: string }) {
  const email = args.created_by || getCurrentUserEmail();
  if (!email) throw new Error("created_by is required (and could not be automatically detected).");
  const selector = `Filter(TimeEntries, AND([CreatedBy] = "${email}", ISBLANK([EndAt])))`;
  const timers = await appsheetAction("TimeEntries", "Find", [], { Selector: selector }) as Record<string, unknown>[];
  if (!Array.isArray(timers) || timers.length === 0) return { active: false, timer: null };
  return { active: true, timer: timers[0] };
}

async function handleSearchTasks(args: { query: string; status?: string; assignee_email?: string }) {
  const filters: string[] = [`CONTAINS(LOWER([TaskName]), LOWER("${args.query}"))`];
  if (args.status) filters.push(`[Status] = "${args.status}"`);
  if (args.assignee_email) {
    const rowId = await resolvePeopleRowId(args.assignee_email);
    filters.push(`[AssigneeEmail] = "${rowId}"`);
  }
  return appsheetAction("Tasks", "Find", [], { Selector: buildSelector("Tasks", filters) });
}

async function handleGetOverdueTasks(args: { assignee_email?: string; project_id?: string }) {
  const today = new Date().toISOString().split("T")[0];
  const filters: string[] = [
    `[DueDate] < "${today}"`,
    `NOT(IN([Status], {"Completed"}))`,
    `NOT(ISBLANK([DueDate]))`,
  ];
  if (args.assignee_email) {
    const rowId = await resolvePeopleRowId(args.assignee_email);
    filters.push(`[AssigneeEmail] = "${rowId}"`);
  }
  if (args.project_id) filters.push(`[ProjectID] = "${args.project_id}"`);
  return appsheetAction("Tasks", "Find", [], { Selector: buildSelector("Tasks", filters) });
}

async function handleReassignTask(args: { task_id: string; assignee_email: string }) {
  const rowId = await resolvePeopleRowId(args.assignee_email);
  return appsheetAction("Tasks", "Edit", [{ TaskID: args.task_id, AssigneeEmail: rowId }]);
}

async function handleApprovePtoRequest(args: { request_id: string; reviewed_by?: string; notes?: string }) {
  const reviewedBy = args.reviewed_by || getCurrentUserEmail();
  if (!reviewedBy) throw new Error("reviewed_by is required (and could not be automatically detected).");
  const row: Record<string, unknown> = {
    RequestID: args.request_id,
    Status: "Approved",
    ReviewedBy: reviewedBy,
    ReviewedAt: nowIso(),
  };
  if (args.notes) row.ReviewNotes = args.notes;
  return appsheetAction("PTO_Requests", "Edit", [row]);
}

async function handleRejectPtoRequest(args: { request_id: string; reviewed_by?: string; notes?: string }) {
  const reviewedBy = args.reviewed_by || getCurrentUserEmail();
  if (!reviewedBy) throw new Error("reviewed_by is required (and could not be automatically detected).");
  const row: Record<string, unknown> = {
    RequestID: args.request_id,
    Status: "Rejected",
    ReviewedBy: reviewedBy,
    ReviewedAt: nowIso(),
  };
  if (args.notes) row.ReviewNotes = args.notes;
  return appsheetAction("PTO_Requests", "Edit", [row]);
}

function getMondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split("T")[0];
}

async function handleGetMyTimeSummary(args: { user_email?: string; from_date?: string; to_date?: string }) {
  const email = args.user_email || getCurrentUserEmail();
  if (!email) throw new Error("user_email is required (and could not be automatically detected).");
  const fromDate = args.from_date ?? getMondayOfCurrentWeek();
  const toDate   = args.to_date   ?? new Date().toISOString().split("T")[0];

  const filters = [
    `[UserEmail] = "${email}"`,
    `[Date] >= "${fromDate}"`,
    `[Date] <= "${toDate}"`,
  ];
  const rows = await appsheetAction("TimeFacts", "Find", [], { Selector: buildSelector("TimeFacts", filters) }) as Record<string, unknown>[];

  // Roll up by project
  const byProject: Record<string, number> = {};
  let totalMinutes = 0;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const project = (row.ProjectName as string) ?? "Unassigned";
      const mins = Number(row.DurationMinutes ?? 0);
      byProject[project] = (byProject[project] ?? 0) + mins;
      totalMinutes += mins;
    }
  }

  return {
    user: email,
    period: { from: fromDate, to: toDate },
    total_hours: +(totalMinutes / 60).toFixed(2),
    by_project: Object.entries(byProject).map(([project, minutes]) => ({
      project,
      hours: +(minutes / 60).toFixed(2),
    })).sort((a, b) => b.hours - a.hours),
    raw_rows: rows,
  };
}

async function handleGetWeeklyDigest(args: { user_email?: string }) {
  const email = args.user_email || getCurrentUserEmail();
  if (!email) throw new Error("user_email is required (and could not be automatically detected).");

  const rowId     = await resolvePeopleRowId(email);
  const todayStr  = new Date().toISOString().split("T")[0];
  const mondayStr = getMondayOfCurrentWeek();

  const taskSel = buildSelector("Tasks", [
    `[AssigneeEmail] = "${rowId}"`,
    `IN([Status], {"To Do", "In Progress", "Blocked"})`,
  ]);
  const eventSel = buildSelector("CalendarEvents", [
    `[UserEmail] = "${email}"`,
    `[StartAt] >= "${mondayStr} 00:00:00"`,
    `[StartAt] <= "${todayStr} 23:59:59"`,
  ]);
  const timeSel = buildSelector("TimeEntries", [
    `[CreatedBy] = "${email}"`,
    `[StartAt] >= "${mondayStr} 00:00:00"`,
  ]);

  const [tasks, events, timeEntries] = await Promise.all([
    appsheetAction("Tasks",        "Find", [], taskSel  ? { Selector: taskSel  } : {}),
    appsheetAction("CalendarEvents","Find", [], eventSel ? { Selector: eventSel } : {}),
    appsheetAction("TimeEntries",  "Find", [], timeSel  ? { Selector: timeSel  } : {}),
  ]);

  return {
    user: { email, rowId },
    week: { from: mondayStr, to: todayStr },
    open_tasks: tasks,
    week_events: events,
    week_time_entries: timeEntries,
  };
}

async function handleGetMissions(args: { enterprise_id?: string; name_search?: string }) {
  const filters: string[] = [];
  if (args.enterprise_id) filters.push(`[EnterpriseID] = "${args.enterprise_id}"`);
  if (args.name_search)   filters.push(`CONTAINS(LOWER([MissionName]), LOWER("${args.name_search}"))`);
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("Missions", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("Missions", "Find", [], properties);
}

async function handleGetInitiatives(args: { mission_id?: string; name_search?: string }) {
  const filters: string[] = [];
  if (args.mission_id)  filters.push(`[MissionID] = "${args.mission_id}"`);
  if (args.name_search) filters.push(`CONTAINS(LOWER([InitiativeName]), LOWER("${args.name_search}"))`);
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("Initiatives", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("Initiatives", "Find", [], properties);
}

async function handleGetRocks(args: {
  enterprise_id?: string; assignee_email?: string; quarter?: string;
  year?: string; status?: string; scope?: string; name_search?: string;
}) {
  const filters: string[] = [];
  if (args.enterprise_id)  filters.push(`[EnterpriseID] = "${args.enterprise_id}"`);
  if (args.quarter)        filters.push(`[Quarter] = "${args.quarter}"`);
  if (args.year)           filters.push(`[Year] = "${args.year}"`);
  if (args.status)         filters.push(`[Status] = "${args.status}"`);
  if (args.scope)          filters.push(`[Scope] = "${args.scope}"`);
  if (args.name_search)    filters.push(`CONTAINS(LOWER([RockName]), LOWER("${args.name_search}"))`);
  if (args.assignee_email) {
    const rowId = await resolvePeopleRowId(args.assignee_email);
    filters.push(`[AssigneeEmail] = "${rowId}"`);
  }
  const properties: Record<string, unknown> = {};
  const sel = buildSelector("Rocks", filters);
  if (sel) properties.Selector = sel;
  return appsheetAction("Rocks", "Find", [], properties);
}

async function handleGetRockDetail(args: { rock_id: string }) {
  return appsheetAction("Rocks", "Find", [], {
    Selector: `Filter(Rocks, [RockID] = "${args.rock_id}")`,
  });
}

async function handleGetOverdueRocks(args: { enterprise_id?: string; assignee_email?: string }) {
  const today = new Date().toISOString().split("T")[0];
  const filters: string[] = [
    `[DueDate] < "${today}"`,
    `NOT(ISBLANK([DueDate]))`,
    `NOT(IN([Status], {"Done"}))`,
  ];
  if (args.enterprise_id) filters.push(`[EnterpriseID] = "${args.enterprise_id}"`);
  if (args.assignee_email) {
    const rowId = await resolvePeopleRowId(args.assignee_email);
    filters.push(`[AssigneeEmail] = "${rowId}"`);
  }
  return appsheetAction("Rocks", "Find", [], { Selector: buildSelector("Rocks", filters) });
}

async function handleCreateRock(args: {
  rock_name: string; enterprise_id: string; quarter: string; year: string;
  scope?: string; assignee_email?: string; mission_id?: string;
  due_date?: string; success_criteria?: string;
}) {
  // Get enterprise to derive its code for the RockID
  const enterprises = await appsheetAction("Enterprises", "Find", [], {
    Selector: `Filter(Enterprises, [EnterpriseID] = "${args.enterprise_id}")`,
  }) as Record<string, unknown>[];
  if (!Array.isArray(enterprises) || enterprises.length === 0) {
    throw new Error(`Enterprise not found: ${args.enterprise_id}. Call list_enterprises to get valid IDs.`);
  }
  const enterprise = enterprises[0];
  const enterpriseCode = (
    enterprise.EnterpriseCode ?? enterprise.EnterpriseName ?? args.enterprise_id
  ) as string;

  // Find existing rocks for this enterprise/year/quarter to avoid ID collision
  const existingRocks = await appsheetAction("Rocks", "Find", [], {
    Selector: buildSelector("Rocks", [
      `[EnterpriseID] = "${args.enterprise_id}"`,
      `[Year] = "${args.year}"`,
      `[Quarter] = "${args.quarter}"`,
    ]),
  }) as Record<string, unknown>[];

  const prefix = `R-${enterpriseCode}-${args.year}${args.quarter}-`;
  let maxSeq = 0;
  if (Array.isArray(existingRocks)) {
    for (const rock of existingRocks) {
      const id = rock.RockID as string;
      if (id && id.startsWith(prefix)) {
        const seq = parseInt(id.slice(prefix.length), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }

  const rockId = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
  const row: Record<string, unknown> = {
    RockID:        rockId,
    RockName:      args.rock_name,
    Scope:         args.scope ?? "Individual Rock",
    EnterpriseID:  args.enterprise_id,
    Quarter:       args.quarter,
    Year:          args.year,
    Status:        "On Track",
    StatusUpdated: nowIso(),
  };
  if (args.assignee_email)   row.AssigneeEmail    = await resolvePeopleRowId(args.assignee_email);
  if (args.mission_id)       row.MissionID        = args.mission_id;
  if (args.due_date)         row.DueDate          = args.due_date;
  if (args.success_criteria) row.SuccessCriteria  = args.success_criteria;

  return appsheetAction("Rocks", "Add", [row]);
}

async function handleUpdateRockStatus(args: { rock_id: string; status: string; updated_by?: string }) {
  const updatedBy = args.updated_by || getCurrentUserEmail() || "";
  return appsheetAction("Rocks", "Edit", [{
    RockID:            args.rock_id,
    Status:            args.status,
    StatusUpdated:     nowIso(),
    StatusUpdatedBy:   updatedBy,
  }]);
}

async function handleGetEnterpriseVision(args: { enterprise_id?: string }) {
  const enterpriseProperties: Record<string, unknown> = {};
  if (args.enterprise_id) {
    enterpriseProperties.Selector = `Filter(Enterprises, [EnterpriseID] = "${args.enterprise_id}")`;
  }
  const visionProperties: Record<string, unknown> = {};
  if (args.enterprise_id) {
    visionProperties.Selector = `Filter(VisionPictures, [EnterpriseID] = "${args.enterprise_id}")`;
  }
  const [enterprises, visionPictures] = await Promise.all([
    appsheetAction("Enterprises", "Find", [], enterpriseProperties),
    appsheetAction("VisionPictures", "Find", [], visionProperties).catch(() => []),
  ]);
  return { enterprises, visionPictures };
}

async function handleListEnterprises() {
  return appsheetAction("Enterprises", "Find", [], {});
}

// ─── Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: "manna-family-appsheet", version: "1.4.0" },
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
      case "get_current_user":    result = await handleGetCurrentUser(); break;
      case "start_timer":         result = await handleStartTimer(a as never); break;
      case "stop_timer":          result = await handleStopTimer(a as never); break;
      case "get_daily_digest":    result = await handleGetDailyDigest(a as never); break;
      case "get_active_timer":    result = await handleGetActiveTimer(a as never); break;
      case "search_tasks":        result = await handleSearchTasks(a as never); break;
      case "get_overdue_tasks":   result = await handleGetOverdueTasks(a as never); break;
      case "reassign_task":       result = await handleReassignTask(a as never); break;
      case "approve_pto_request": result = await handleApprovePtoRequest(a as never); break;
      case "reject_pto_request":  result = await handleRejectPtoRequest(a as never); break;
      case "get_my_time_summary": result = await handleGetMyTimeSummary(a as never); break;
      case "get_weekly_digest":   result = await handleGetWeeklyDigest(a as never); break;
      case "get_missions":          result = await handleGetMissions(a as never); break;
      case "get_initiatives":       result = await handleGetInitiatives(a as never); break;
      case "get_rocks":             result = await handleGetRocks(a as never); break;
      case "get_rock_detail":       result = await handleGetRockDetail(a as never); break;
      case "get_overdue_rocks":     result = await handleGetOverdueRocks(a as never); break;
      case "create_rock":           result = await handleCreateRock(a as never); break;
      case "update_rock_status":    result = await handleUpdateRockStatus(a as never); break;
      case "get_enterprise_vision": result = await handleGetEnterpriseVision(a as never); break;
      case "list_enterprises":      result = await handleListEnterprises(); break;
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
  console.error("✅ Manna Family AppSheet MCP Server running (v1.4.0)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
