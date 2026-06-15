# The Manna Family — AppSheet MCP Server Schema Reference

## App Metadata

| Property | Value |
|---|---|
| App Name | The Manna Family |
| AppSheet App ID | `d39f2089-f7d8-4177-a068-321b1174a305` |
| AppSheet App Name (URL) | `TaskManagement-Jair-916259694` |
| Database ID | `PfbtRk8-UE43M6zBoQPYx6` |
| API Integration | Enabled (2 access keys exist) |
| API Base URL | `https://api.appsheet.com/api/v2/apps/d39f2089-f7d8-4177-a068-321b1174a305/tables/{TableName}/Action` |

> Reveal and copy one of the Application Access Keys from **Settings → Integrations** to authenticate API calls.

---

## API Usage Pattern

All CRUD operations use a POST request:

```http
POST https://api.appsheet.com/api/v2/apps/{APP_ID}/tables/{TABLE_NAME}/Action
Authorization: ApplicationAccessKey {YOUR_ACCESS_KEY}
Content-Type: application/json

Body:
{
  "Action": "Find" | "Add" | "Edit" | "Delete",
  "Properties": {},
  "Rows": [...]
}
```

---

## Tables

### 1. Projects

**Key Column:** `ProjectID` | **Columns:** 18

| Column | Type | Notes |
|---|---|---|
| ProjectID | Text | 🔑 Primary Key (e.g. P001, P002) |
| ProjectName | Text | Label column |
| Status | Enum | Active, On Hold, Completed |
| StartDate | Date | |
| EndDate | Date | |
| Description | Text | |
| CreatedBy | Email | |
| Collaborators | EnumList | List of user emails |
| InitiativeID | Ref → Initiatives | Foreign key |
| URL Attachment | Url | |
| Related Tasks | List | Virtual — reverse ref from Tasks |
| Related Time Entries | List | Virtual |
| Related CalendarEvents | List | Virtual |
| Related _Per User Setting | List | Virtual |
| Debug_CurrentUserRowID | Ref → People | |
| Debug_IsCollaborator | Yes/No | |

---

### 2. Tasks

**Key Column:** `TaskID` | **Columns:** 23

| Column | Type | Notes |
|---|---|---|
| TaskID | Text | 🔑 Primary Key |
| TaskName | Text | Label column |
| Status | Enum | To Do, In Progress, Blocked, Completed |
| Prority | Enum | High, Medium, Low *(note: "Prority" is the actual column name)* |
| DueDate | Date | |
| Repeat? | Enum | No, Daily, Weekly, Bi-Weekly, Monthly |
| CreatedBy | Email | |
| CreatedAt | DateTime | |
| CompletedAt | DateTime | |
| AssigneeEmail | Enum | References People.Email |
| ProjectID | Ref → Projects | Foreign key |
| Task Type | EnumList | |
| Comments | List | Virtual — reverse ref from Comments |
| Related TimeEntries | List | Virtual |
| HasOpenTimer | Yes/No | Computed |
| RunningFromMe | Yes/No | Computed |
| MissionName | Ref → Missions | |
| EnterpriseName | Text | Computed/denormalized |
| InitiativeName | Text | Computed/denormalized |
| Hours Spent | Decimal | Computed |
| UserName | Text | Computed from current user |

---

### 3. People

**Key Column:** `Email` | **Columns:** 28

| Column | Type | Notes |
|---|---|---|
| Email | Email | 🔑 Primary Key |
| UserName | Text | Label column |
| JobTitle | Text | |
| Role | Enum | Admin, User |
| Supervisor | Enum | |
| FirefliesNotesFolderUrl | Url | |
| Position | Enum | Staff/Non-Professional, Entry Level Professional, Advanced Professional, Supervisor, Director, Senior Director |
| HireDate | Date | |
| HoursPerWeek | Number | |
| CarryoverPTO_ThisYear | Number | |
| MBC? | Yes/No | Belongs to MBC enterprise |
| MGM? | Yes/No | Belongs to MGM enterprise |
| EP? | Yes/No | Belongs to EP enterprise |
| Related Comments | List | Virtual |
| YearsOfService | Number | Computed |
| AnnualPTO_BaseDays | Number | |
| PTO_ReductionPercent | Decimal | |
| AnnualPTO_AdjustedDays | Decimal | Computed |
| MonthlyPTO_AccrualDays | Decimal | Computed |
| CompletedMonths_ThisYear | Number | Computed |
| PTO_Accrued_YTD | Decimal | Computed |
| PTO_Used_YTD | Decimal | Computed |
| PTO_Balance_Current | Decimal | Computed |
| Related PTO_Requests | List | Virtual |
| Related _Per User Setting | List | Virtual |
| Related Projects | List | Virtual |

---

### 4. Comments

**Key Column:** `CommentID` | **Columns:** 7

| Column | Type | Notes |
|---|---|---|
| CommentID | Text | 🔑 Primary Key |
| TaskID | Text | Foreign key → Tasks.TaskID |
| CommentText | LongText | |
| CreatedAt | DateTime | |
| AddedBy | Ref → People | Foreign key |

---

### 5. TimeEntries

**Key Column:** `TimeEntryID` | **Columns:** 11

| Column | Type | Notes |
|---|---|---|
| TimeEntryID | Text | 🔑 Primary Key |
| TaskID | Ref → Tasks | Foreign key |
| EntryDescription | Text | |
| StartAt | DateTime | |
| EndAt | DateTime | |
| DurationMinutes | Decimal | |
| CreatedAt | DateTime | |
| CreatedBy | Email | |
| Method | Enum | Manual, Timer |

---

### 6. Enterprises

**Key Column:** `EnterpriseID` | **Columns:** 10

| Column | Type | Notes |
|---|---|---|
| EnterpriseID | Text | 🔑 Primary Key |
| EnterpriseName | Text | Label column |
| VisionStatement | LongText | |
| BoardofDirectors | LongText | |
| ExecutiveDirectors | Text | |
| Related Missions | List | Virtual |
| EnterpriseProfile | LongText | |
| EnterpriseVisibleToUser | Yes/No | |

---

### 7. Missions

**Key Column:** `MissionID` | **Columns:** 7

| Column | Type | Notes |
|---|---|---|
| MissionID | Text | 🔑 Primary Key |
| MissionName | Text | Label column |
| EnterpriseID | Ref → Enterprises | Foreign key |
| Related Tasks | List | Virtual |
| Related Initiatives | List | Virtual |

---

### 8. Initiatives

**Key Column:** `InitiativeID` | **Columns:** 6

| Column | Type | Notes |
|---|---|---|
| InitiativeID | Text | 🔑 Primary Key |
| InitiativeName | Text | Label column |
| MissionID | Ref → Missions | Foreign key |
| Related Projects | List | Virtual |

---

### 9. PTO_Requests

**Key Column:** `RequestID` | **Columns:** 17

| Column | Type | Notes |
|---|---|---|
| RequestID | Text | 🔑 Primary Key |
| Reason | LongText | |
| Requester | Ref → People | Foreign key |
| Type | Enum | PTO, CompTime, Sick, Unpaid |
| CompTime_TravelDays | Decimal | |
| StartDate | Date | |
| DayCount | Decimal | |
| EndDate | Date | |
| HalfPortion | Enum | Morning, Afternoon |
| SubmittedAt | DateTime | |
| Emergency | Yes/No | |
| Status | Enum | Submitted, Draft, Approved, Rejected, Cancelled |
| ApprovedBy | Email | |
| ApprovedAt | DateTime | |
| CompTime_Available | Number | Computed |

---

### 10. PTO_Policy

**Key Column:** `Position` | **Columns:** 6

| Column | Type | Notes |
|---|---|---|
| Position | Text | 🔑 Primary Key (matches People.Position) |
| YearsMin | Number | Min years of service |
| YearsMax | Number | Max years of service |
| AnnualDays | Number | PTO days allotted |

---

### 11. Resources

**Key Column:** `Name` | **Columns:** 5

| Column | Type | Notes |
|---|---|---|
| Name | Text | 🔑 Primary Key |
| LinkType | Enum | Dashboard, Agreement |
| URL | Url | |

---

### 12. OrgHolidays

**Key Column:** `Holiday` | **Columns:** 4

| Column | Type | Notes |
|---|---|---|
| Holiday | Text | 🔑 Primary Key |
| Date | Date | |

---

### 13. CalendarEvents

**Key Column:** `EventKey` | **Columns:** 13

| Column | Type | Notes |
|---|---|---|
| EventKey | Text | 🔑 Primary Key |
| UserEmail | Email | Owner of the event |
| CalendarId | Text | Google Calendar ID |
| EventId | Text | Google Calendar event ID |
| Title | Text | |
| Description | Text | |
| StartAt | DateTime | |
| EndAt | DateTime | |
| ProjectID_Suggested | Ref → Projects | AI-suggested project link |
| ImportedAt | DateTime | |
| isCategorized? | Yes/No | |

---

### 14. TimeFacts

**Key Column:** `TimeFactKey` | **Columns:** 23

> Read-only reporting/aggregation table — treat as read-only.

| Column | Type | Notes |
|---|---|---|
| TimeFactKey | Text | 🔑 Primary Key |
| Source | Text | Source table name |
| SourceRowID | Text | Row ID from source |
| UserEmail | Text | |
| UserName | Text | |
| StartAt | DateTime | |
| EndAt | DateTime | |
| DurationMinutes | Number | |
| Date | Date | |
| WeekStart | Date | Week grouping |
| EnterpriseName | Text | Denormalized |
| MissionName | Text | Denormalized |
| InitiativeName | Text | Denormalized |
| ProjectRowID | Text | |
| ProjectName | Text | |
| ParentType | Text | |
| ParentID | Text | |
| ParentName | Text | |
| TaskRowID | Text | |
| TaskName | Text | |
| Method | Text | Manual or Timer |

---

## Table Relationships

```
Enterprise  ──has many──▶  Missions
Mission     ──has many──▶  Initiatives
Mission     ──has many──▶  Tasks         (via Tasks.MissionName)
Initiative  ──has many──▶  Projects      (via Projects.InitiativeID)
Project     ──has many──▶  Tasks         (via Tasks.ProjectID)
Project     ──has many──▶  CalendarEvents
Task        ──has many──▶  Comments      (via Comments.TaskID)
Task        ──has many──▶  TimeEntries   (via TimeEntries.TaskID)
Person      ──has many──▶  Tasks         (via Tasks.AssigneeEmail)
Person      ──has many──▶  Comments      (via Comments.AddedBy)
Person      ──has many──▶  PTO_Requests  (via PTO_Requests.Requester)
Person      ──has many──▶  Projects      (via Projects.Collaborators)
PTO_Policy  ──lookup──────  People        (via People.Position)
```

---

## MCP Server Implementation Notes

### Recommended MCP Tools

| Tool | AppSheet Action | Description |
|---|---|---|
| `list_records` | Find | Query any table with optional filters |
| `get_record` | Find | Fetch a single record by key column |
| `create_record` | Add | Insert a new row |
| `update_record` | Edit | Update a row (must include key column) |
| `delete_record` | Delete | Remove a row (must include key column) |

### Key Implementation Details

- **Table names are case-sensitive** in the API. Use exact names: `Projects`, `Tasks`, `People`, `Comments`, `TimeEntries`, `Resources`, `OrgHolidays`, `CalendarEvents`, `PTO_Policy`, `PTO_Requests`, `Enterprises`, `Missions`, `Initiatives`, `TimeFacts`
- **Row ID vs Key Column** — every table has an auto-generated `Row ID` (AppSheet internal). The user-defined key (e.g. `ProjectID`, `TaskID`) is what you use in Ref/Foreign key relationships and for the `Edit`/`Delete` API actions.
- **Virtual List columns** (e.g. `Related Tasks`, `Comments`, `Related TimeEntries`) are computed reverse-references. They are read-only and cannot be written via the API.
- **Computed columns** (e.g. `Hours Spent`, `PTO_Balance_Current`, `YearsOfService`) are read-only.
- **People.Email** is the primary key for the People table — not a separate ID field.
- **TimeFacts** is a read-only aggregated time-tracking fact table. Do not attempt writes.
- The database is an **AppSheet native database** (not Google Sheets), so there are no spreadsheet paths needed.

### Authentication Header

```http
ApplicationAccessKey YOUR_KEY_HERE
```

Get your key from: **AppSheet Editor → Settings → Integrations → Application Access Keys → Show Access Key**
