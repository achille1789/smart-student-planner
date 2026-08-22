# Smart Student Planner — AI Service

AI-powered backend service for the **Smart Student Planner** application.

The service exposes a single AWS API Gateway endpoint backed by a Node.js Lambda function that uses an LLM (via [OpenRouter](https://openrouter.ai)) to break a student's study goal down into a realistic plan of 3 actionable tasks.

---

## Architecture

```
Client ──POST──► API Gateway (REGIONAL, API key required)
                       │
                       ▼
                AWS Lambda (Node.js 24.x)
                       │
                       ▼
                OpenRouter Chat Completions API
```

- **API Gateway** — public REST API, regional endpoint, API-key protected, access-logged to CloudWatch (60-day retention).
- **Lambda** — 2-minute timeout, 256 MB, logs to CloudWatch (60-day retention). Reads `OPENROUTER_API_KEY` from environment variables.
- **Terraform** — full IaC in the [`iac/`](./iac) folder, state stored in S3.

---

## API Reference

### `POST /ssp/ai-assistant`

Generate a 3-task study plan from a student goal.

#### Headers

| Header | Required | Description |
|---|---|---|
| `Content-Type` | ✅ | Must be `application/json` |
| `x-api-key` | ✅ | The API key provisioned by Terraform (see `terraform output api_key_value`) |

#### Request body

```json
{
  "goal": "I want to pass my Computer Networks exam by the end of the month",
  "due_date": "2026-12-31",
  "user_id": "1786138783625x982334246337686000"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `goal` | string | ✅ | Free-text description of the student's study goal. Any language is accepted; the response is always in English. |
| `due_date` | string | ✅ | Overall deadline for the goal. Accepted formats: `YYYY-MM-DD` or `DD/MM/YYYY`. |
| `user_id` | string | optional | Opaque identifier of the requesting student (passed through for tracing/logging). |

#### Successful response — `200 OK`

Returns exactly **3 tasks** ordered chronologically, forming a realistic study plan (foundation → practice → final review).

```json
{
  "tasks": [
    {
      "title": "Review OSI Model and TCP/IP Stack",
      "description": "Go through chapters 1-3 of the textbook and create a summary sheet of all protocol layers and their functions.",
      "due_date": "10/12/2026",
      "category": "🎓 Exam Revision",
      "priority": "High",
      "workload": "Moderate (1-3 hrs)"
    },
    {
      "title": "Practice past exam papers",
      "description": "Complete at least 3 past exam papers under timed conditions and review the answers.",
      "due_date": "20/12/2026",
      "category": "🎓 Exam Revision",
      "priority": "Medium",
      "workload": "Heavy (3+ hrs)"
    },
    {
      "title": "Final consolidation and weak-topic review",
      "description": "Revisit any topics missed in the mocks and produce a one-page cheat sheet.",
      "due_date": "30/12/2026",
      "category": "🎓 Exam Revision",
      "priority": "High",
      "workload": "Light (<1 hr)"
    }
  ]
}
```

##### Field constraints

| Field | Constraint |
|---|---|
| `title` | English string, ≤ 200 chars |
| `description` | English string, 1–2 sentences, ≤ 1000 chars |
| `due_date` | `DD/MM/YYYY`, unique per task, between today and the goal `due_date` |
| `category` | One of: `📚 Coursework`, `📝 Assignment`, `🎓 Exam Revision`, `👥 Group Project`, `💻 Laboratory`, `📖 Reading`, `🧑‍🏫 Lecture`, `📅 Meeting`, `📧 Administrative`, `🏠 Personal` |
| `priority` | One of: `Low`, `Medium`, `High` (varied across tasks) |
| `workload` | One of: `Light (<1 hr)`, `Moderate (1-3 hrs)`, `Heavy (3+ hrs)` (varied across tasks) |

#### Error responses

| Status | Body | Cause |
|---|---|---|
| `400` | `{ "error": "Invalid JSON body" }` | Request body is not valid JSON |
| `400` | `{ "error": "Missing required fields: goal, due_date" }` | Required field missing |
| `403` | `{ "message": "Forbidden" }` | Missing or invalid `x-api-key` |
| `500` | `{ "error": "Failed to generate tasks", "details": "..." }` | Upstream OpenRouter error or unparseable AI response |

---

## Local development

Requirements: Node.js 24+, Terraform, an AWS account, and an OpenRouter API key.

Create a `.env` file at the repo root:

```env
OPENROUTER_API_KEY=sk-or-...
TF_VAR_openrouter_api_key=sk-or-...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=eu-west-2
```

### Scripts

| Command | Description |
|---|---|
| `npm run build` | Bundles `src/app.ts` into `dist/index.js` via esbuild |
| `npm run tf:init` | Initialises Terraform (S3 backend) |
| `npm run tf:plan` | Shows planned infrastructure changes |
| `npm run tf:apply` | Applies infrastructure changes |
| `npm run deploy` | Full pipeline: build → tf init → tf apply |
| `npm run debug` | Runs the handler locally against a sample event |

After a successful deploy, retrieve the endpoint URL and API key:

```bash
cd iac
terraform output api_gateway_url
terraform output -raw api_key_value
```

---

## Repository layout

```
smart-student-planner/
├── src/
│   └── app.ts          # Lambda handler (goal → 3 tasks)
├── iac/
│   ├── main.tf         # API Gateway, Lambda, CloudWatch, IAM
│   ├── vars.tf         # Input variables
│   └── outputs.tf      # URL, API key, Lambda name
├── build.js            # esbuild bundling script
└── package.json
```
