import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openrouter/auto-beta';

const CATEGORIES = [
  '📚 Coursework',
  '📝 Assignment',
  '🎓 Exam Revision',
  '👥 Group Project',
  '💻 Laboratory',
  '📖 Reading',
  '🧑‍🏫 Lecture',
  '📅 Meeting',
  '📧 Administrative',
  '🏠 Personal',
];
const PRIORITIES = ['Low', 'Medium', 'High'];
const WORKLOADS = ['Light (<1 hr)', 'Moderate (1-3 hrs)', 'Heavy (3+ hrs)'];

interface GoalRequest {
  goal: string;
  due_date: string;
  user_id: string;
}

interface Task {
  title: string;
  description: string;
  due_date: string;
  category: string;
  priority: string;
  workload: string;
}

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event.body, null, 2));

  // 1. Parse and validate the incoming request body
  let payload: GoalRequest;
  try {
    payload = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body as any);
  } catch (err) {
    console.error('Invalid JSON body:', err);
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (!payload || !payload.goal || !payload.due_date) {
    return jsonResponse(400, { error: 'Missing required fields: goal, due_date' });
  }

  // 2. Ask the AI to break the goal down into tasks
  try {
    const tasks = await _breakDownGoal(payload);
    console.log('Generated tasks:', JSON.stringify(tasks, null, 2));
    return jsonResponse(200, { tasks });
  } catch (err: any) {
    console.error('Error generating tasks:', err);
    return jsonResponse(500, { error: 'Failed to generate tasks', details: err?.message });
  }
};

const _breakDownGoal = async (payload: GoalRequest): Promise<Task[]> => {
  const today = new Date().toISOString().slice(0, 10);

  const daysAvailable = Math.max(
    1,
    Math.ceil((new Date(payload.due_date).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)),
  );

  const systemPrompt = `You are an academic planning assistant that breaks a student's study goal into 3 or 4 concrete, actionable tasks that, once completed, will allow the student to achieve the goal by its due date.

You MUST return ONLY a valid JSON object with this exact shape and nothing else (no markdown, no prose, no code fences):
{
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "due_date": "DD/MM/YYYY",
      "category": "one of the allowed categories",
      "priority": "Low | Medium | High",
      "workload": "Light (<1 hr) | Moderate (1-3 hrs) | Heavy (3+ hrs)"
    }
  ]
}

Rules:
- Produce EXACTLY 3 tasks, ordered chronologically (earliest due_date first).
- Tasks must form a realistic study plan: foundational/preparation work comes first, deeper practice in the middle, and final review/consolidation just before the goal's due date.
- DUE DATES MUST BE DIFFERENT for every task and MUST use the format DD/MM/YYYY (e.g. 07/03/2026). Do NOT reuse the same date and do NOT use any other format. Spread them evenly between today (${today}) and the goal due date (${payload.due_date}). You have roughly ${daysAvailable} day(s) to plan across. The LAST task's due_date should be on or a day or two before the goal due date, never after.
- PRIORITIES MUST VARY across the tasks. Do NOT set every task to the same priority. Typically foundational or final-review tasks are "High", intermediate reinforcement tasks are "Medium", and optional/lighter tasks are "Low". Use at least 2 different priority values across the plan.
- WORKLOADS MUST VARY across the tasks. Do NOT set every task to the same workload. Mix "Light (<1 hr)", "Moderate (1-3 hrs)" and "Heavy (3+ hrs)" based on how much effort each task realistically requires (e.g. quick summaries are Light, deep practice or mock exams are Heavy). Use at least 2 different workload values across the plan.
- "category" must be exactly one of: ${CATEGORIES.join(', ')}.
- "priority" must be exactly one of: ${PRIORITIES.join(', ')}.
- "workload" must be exactly one of: ${WORKLOADS.join(', ')}.
- "description" MUST be written as a SMART objective — Specific, Measurable, Achievable, Relevant and Time-bound. Concretely, every description must:
  * State exactly WHAT the student will do (Specific, e.g. "Read chapters 1–3 of Tanenbaum" not "study networking").
  * Include a QUANTIFIABLE outcome or amount (Measurable, e.g. "complete 20 subnetting exercises", "produce a 1-page summary", "score ≥ 70% on a mock paper").
  * Be realistically doable within the task's workload band (Achievable).
  * Directly contribute to the overall student goal (Relevant — reference the topic/skill from the goal).
  * Be Time-bound implicitly through the task's own due_date field. Do NOT restate the date, day or month inside the description text — the due_date field already carries that information. Instead convey urgency with phrases like "before the deadline", "ahead of the next task" or "by the end of this task's window".
  Keep it to 1–2 concise sentences, ≤ 300 characters, plain prose (no bullet points, no markdown).
- ALL text fields ("title", "description", "category", "priority", "workload") MUST be written in ENGLISH ONLY, regardless of the language of the student's goal. Do NOT use any other language or script (no Chinese, Spanish, Arabic, etc.). If the goal is written in another language, translate it internally and produce the plan in English.
- Return valid JSON only.`;

  const userPrompt = `Student goal: ${payload.goal}
Goal due date: ${payload.due_date}
Today's date: ${today}
Days available: ${daysAvailable}

Build a realistic study plan of EXACTLY 3 tasks, written entirely in ENGLISH. Every task "description" MUST be a SMART objective (Specific, Measurable, Achievable, Relevant, Time-bound) that references the goal's topic and includes a concrete, quantifiable outcome. Do NOT restate any date, day or month inside the "description" — the "due_date" field already conveys the deadline. Remember: every task must have a DIFFERENT due_date in DD/MM/YYYY format, spread across the available time, and priorities and workloads must vary between tasks (at least 2 distinct values each). Return only the JSON object described in the system message.`;

  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter API call failed: ${resp.status} ${errText}`);
  }

  const result: any = await resp.json();
  console.log('AI raw result:', JSON.stringify(result, null, 2));

  const content: string | undefined = result?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI response did not contain content');
  }

  const parsed = _extractJson(content);
  const tasks: Task[] = Array.isArray(parsed?.tasks) ? parsed.tasks : [];

  if (tasks.length === 0) {
    throw new Error('AI response did not contain any tasks');
  }

  // Normalise/validate each task defensively so the client always gets valid values
  let normalised = tasks.slice(0, 3).map((t) => _sanitiseTask(t, payload.due_date));

  // Ensure we always return exactly 3 tasks: pad with sensible fillers if the AI returned fewer
  while (normalised.length < 3) {
    normalised.push(
      _sanitiseTask(
        {
          title: `Follow-up study task ${normalised.length + 1}`,
          description: 'Continue working on the goal with focused study or practice.',
          due_date: payload.due_date,
          category: '📚 Coursework',
          priority: 'Medium',
          workload: 'Moderate (1-3 hrs)',
        },
        payload.due_date,
      ),
    );
  }

  // Safety net: if the AI ignored the instructions and returned identical due dates,
  // spread them evenly between today and the goal due date so tasks are actionable in order.
  return _spreadDueDatesIfIdentical(normalised, payload.due_date);
};

// If every task has the same due_date, redistribute them evenly across the available window
const _spreadDueDatesIfIdentical = (tasks: Task[], goalDueDate: string): Task[] => {
  if (tasks.length < 2) return tasks;

  const unique = new Set(tasks.map((t) => t.due_date));
  if (unique.size > 1) return tasks;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const goal = _parseGoalDate(goalDueDate);
  if (!goal) return tasks;
  goal.setUTCHours(0, 0, 0, 0);

  const totalMs = goal.getTime() - today.getTime();
  if (totalMs <= 0) return tasks;

  // Divide the window into (tasks.length) intervals so the last task lands on the goal date
  const step = totalMs / tasks.length;

  return tasks.map((t, idx) => {
    const d = new Date(today.getTime() + step * (idx + 1));
    return { ...t, due_date: _formatDDMMYYYY(d) };
  });
};

// Accepts YYYY-MM-DD or DD/MM/YYYY inputs (the incoming goal due_date can be either)
const _parseGoalDate = (raw: string): Date | null => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw);
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`);
  return null;
};

const _formatDDMMYYYY = (d: Date): string => {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

// Extract JSON from the AI response even if it comes wrapped in ```json ... ``` fences
const _extractJson = (raw: string): any => {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Unable to parse JSON from AI response');
  }
};

const _sanitiseTask = (t: any, goalDueDate: string): Task => {
  const category = CATEGORIES.includes(t?.category) ? t.category : '📚 Coursework';
  const priority = PRIORITIES.includes(t?.priority) ? t.priority : 'Medium';
  const workload = WORKLOADS.includes(t?.workload) ? t.workload : 'Moderate (1-3 hrs)';
  const due_date = _normaliseDueDate(t?.due_date, goalDueDate);

  return {
    title: String(t?.title ?? 'Untitled task').slice(0, 200),
    description: String(t?.description ?? '').slice(0, 1000),
    due_date,
    category,
    priority,
    workload,
  };
};

// Force any incoming date into DD/MM/YYYY; fall back to the goal due date if unparseable
const _normaliseDueDate = (raw: any, goalDueDate: string): string => {
  if (typeof raw === 'string') {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }
  const goal = _parseGoalDate(goalDueDate);
  return goal ? _formatDDMMYYYY(goal) : goalDueDate;
};

