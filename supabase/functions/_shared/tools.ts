// One brain, one tool contract. The web /chat and the WhatsApp/sweep core
// (assistantCore) share these tool DEFINITIONS so buno's capabilities can't drift
// between surfaces. The IMPLEMENTATIONS stay per-surface for now (web runs under the
// user's JWT/RLS; the core runs admin-scoped) — unified next. manage_event is web-only
// (WhatsApp omits it from its tools array).

export const CREATE_CARD_TOOL = {
  name: "create_card",
  description:
    "Create a task card on the user's board. Use this only when the user clearly asks to add/open/create a task, or explicitly agrees to a card you offered. Cards are created as pending drafts the user approves — you never bypass that. Prefer the project the user names; if none, it goes to their current project.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short task title, ≤10 words, starting with a verb. In Hebrew." },
      description: { type: "string", description: "Optional one-sentence context, in Hebrew." },
      project_id: { type: "string", description: "The id of the target project. MUST be copied verbatim from the 'פרויקטים (id → שם)' list in the system prompt — pick the id whose name matches where the task belongs. If you are not sure, or nothing fits, return 'unassigned'. NEVER invent an id, and NEVER put a name here. A personal/home/errand task → the personal board's id (it's in the list)." },
      deadline: { type: "string", description: "Optional due date as YYYY-MM-DD, only if the user stated a real one." },
      priority: { type: "string", enum: ["regular", "important", "critical"], description: "Optional priority; default regular." },
      brief_from: { type: "string", description: "If a specific PERSON gave this brief/estimate/work (e.g. 'the work summarized with אילן', 'a task from דנה'), put that person's NAME here. buno records them as the brief-giver and creates a contact. You are a tool — NEVER put yourself/buno here. Leave empty if no real person is the source." },
      checklist: { type: "array", items: { type: "string" }, description: "When the task is made of a LIST of items or steps (a packing list, a shopping list, sub-steps), put each item here as a separate checklist entry — do NOT cram them into 'description'. Each becomes a checkable subtask. Hebrew, short." },
      people: { type: "array", items: { type: "string" }, description: "Names of PEOPLE the user attached to this task — collaborators / whoever it's 'with' ('עם נמרוד עוז', 'תשתף את דנה'). Each is added as a CC on the card and saved as a contact. Do NOT put yourself/buno here. This is separate from brief_from (the one who GAVE the brief)." },
    },
    required: ["title"],
  },
};

export const CREATE_CARDS_TOOL = {
  name: "create_cards",
  description: "Create MULTIPLE task cards at once. ALWAYS use this (not many create_card calls) when the user asks to add more than one task. Cards are drafts unless the permission level is 'act'.",
  input_schema: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "The id of the project for ALL these cards — copied verbatim from the 'פרויקטים (id → שם)' list in the system prompt, or 'unassigned' if unsure. NEVER a name, NEVER invented. Per-card project_id overrides this." },
      cards: {
        type: "array",
        description: "The tasks to create.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short Hebrew title, verb-first." },
            description: { type: "string" },
            project_id: { type: "string", description: "Optional per-card project id (verbatim from the list, or 'unassigned') — overrides the top-level one." },
            checklist: { type: "array", items: { type: "string" }, description: "Sub-items/steps as a checklist (a packing list, steps) — never in description." },
            deadline: { type: "string", description: "YYYY-MM-DD, only if the user stated one." },
            priority: { type: "string", enum: ["regular", "important", "critical"] },
          },
          required: ["title"],
        },
      },
    },
    required: ["cards"],
  },
};

export const UPDATE_CARD_TOOL = { name: "update_card", description: "Edit EXISTING card(s) on explicit request: deadline, priority, title, description, move to another board, or set the two-time model (work vs waiting), a time estimate, or a follow-up window. Supports BULK — filter_project edits every open card of a project ('all codata → Tuesday'). Only fields you pass change. Single card by title. deadline is YYYY-MM-DD, or 'clear' to remove.", input_schema: { type: "object", properties: { card: { type: "string" }, filter_project: { type: "string" }, deadline: { type: "string" }, priority: { type: "string", enum: ["regular", "important", "critical"] }, title: { type: "string" }, description: { type: "string" }, project: { type: "string" }, card_type: { type: "string", enum: ["work", "waiting"], description: "WORK = something the user does; WAITING = delegated / awaiting a reply." }, waiting_on: { type: "string", description: "Who/what a waiting card waits on, e.g. 'העירייה'. Empty string clears." }, follow_up_days: { type: "number", description: "For a waiting card: silent days before a follow-up nudge (supplier 7, authority 30, other 14)." }, estimate_hours: { type: "number", description: "Time estimate in hours for a work card (drives daily capacity). 0 clears." }, add_subtasks: { type: "array", items: { type: "string" }, description: "Append these as CHECKLIST items (subtasks) to the card. Use whenever the user gives a list of items/steps to include on a task (a packing list, a shopping list, sub-steps) — NEVER dump such a list into 'description'. Hebrew, short, one entry per item." } } } };

export const MOVE_CARD_TOOL = {
  name: "move_card",
  description: "Move an existing card to another column on its board (e.g. to 'בעבודה' / 'לבדיקה'). Use ONLY when the user explicitly asks to move or advance a specific task. Reversible.",
  input_schema: { type: "object", properties: { card: { type: "string", description: "The card's title (or closest match) to move." }, column: { type: "string", description: "Target column name, e.g. 'בעבודה', 'לבדיקה / אישור', 'הושלם'." } }, required: ["card", "column"] },
};

export const COMPLETE_CARD_TOOL = {
  name: "complete_card",
  description: "Mark a card as done — moves it to the board's Done column. Use ONLY when the user explicitly says a specific task is finished. Reversible.",
  input_schema: { type: "object", properties: { card: { type: "string", description: "The card's title to mark done." } }, required: ["card"] },
};

export const ARCHIVE_CARD_TOOL = {
  name: "archive_card",
  description: "Archive a card (remove it from the active board — it can be restored). Use ONLY when the user explicitly asks to remove/archive a specific task.",
  input_schema: { type: "object", properties: { card: { type: "string", description: "The card's title to archive." } }, required: ["card"] },
};

export const CREATE_PROJECT_TOOL = {
  name: "create_project",
  description: "Open a NEW project/board on the user's request (e.g. 'תפתח בורד לקודאטה'). Use ONLY on an explicit request for a new project/board. If a board with that name already exists it is reused.",
  input_schema: { type: "object", properties: { name: { type: "string", description: "The board/project name, in the user's words." } }, required: ["name"] },
};

export const LOG_PROGRESS_TOOL = { name: "log_progress", description: "When the user shares progress on a task ('אני על הסרטון, 4 קליפים מוכנים'), log a short activity note as a comment on the matching card. Only for genuine progress, not for creating tasks.", input_schema: { type: "object", properties: { card: { type: "string" }, note: { type: "string" } }, required: ["card", "note"] } };

export const GET_CARD_LINK_TOOL = { name: "get_card_link", description: "Return a direct link to a specific card when the user asks where it is or to send a link. Identify by title.", input_schema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] } };

export const MANAGE_EVENT_TOOL = { name: "manage_event", description: "Manage a Google Calendar MEETING the user asks to change ('דחה את הפגישה עם X', 'בטל את הפגישה מחר', 'תזמן מחדש ל-15:00'). Identify the meeting by title or attendee (name/email) from the calendar context. Actions: postpone (shift by `minutes`, default 30), move (to an explicit `start_iso`, ISO 8601 in the user's timezone), cancel (delete + notify). Attendees are notified automatically. If the request is vague about which meeting or (for a reschedule) to when, ASK first — don't guess. After it runs, tell the user plainly what changed.", input_schema: { type: "object", properties: { match: { type: "string", description: "Title or attendee name/email identifying the meeting." }, action: { type: "string", enum: ["postpone", "move", "cancel"] }, minutes: { type: "number", description: "For postpone: minutes to shift (default 30)." }, start_iso: { type: "string", description: "For move: the new start, ISO 8601." } }, required: ["match", "action"] } };

// The fuzzy card matcher both surfaces use to resolve a tool's `card` argument to a
// real card — exact title, then contains, then the reverse. Pure (takes the list the
// caller already filtered), so it's identical on web + WhatsApp and can't drift.
export function matchCard(list: any[], q: string): any | null {
  const s = String(q || "").toLowerCase().trim();
  if (!s) return null;
  return list.find((c: any) => (c.title || "").toLowerCase() === s)
    || list.find((c: any) => (c.title || "").toLowerCase().includes(s))
    || list.find((c: any) => c.title && s.includes((c.title || "").toLowerCase()))
    || null;
}

// the canonical WhatsApp/core tool set (everything except calendar management)
// Show a SET of cards as clickable chips (each opens the card; drafts get inline
// approve/reject) INSTEAD of listing them as prose. Use whenever the user asks to
// see / go through / list drafts, open tasks, waiting items, or a project's cards —
// never dump them as a text list.
export const SHOW_CARDS_TOOL = {
  name: "show_cards",
  description: "Render a set of the user's cards as clickable chips instead of describing them in text. ALWAYS use this when asked to show / list / go through drafts, open tasks, waiting items, or a project's cards. After calling it, add at most one short sentence — never re-list the cards in prose.",
  input_schema: { type: "object", properties: {
    filter: { type: "string", enum: ["drafts", "open", "waiting", "overdue", "all"], description: "Which cards: drafts (pending approval) · open (active, not done) · waiting · overdue · all." },
    project_id: { type: "string", description: "Optional — limit to this project's id (verbatim from the projects list)." },
  }, required: ["filter"] },
};

// Merge two cards that are the SAME work (a duplicate the user points out, or two
// signals of one task). Use on an explicit request ("מזג את X ל-Y", "אלה אותה
// משימה"). Content of the duplicate moves onto the keeper; the duplicate is archived.
export const MERGE_CARDS_TOOL = {
  name: "merge_cards",
  description: "Merge one card INTO another when they are the same work — on the user's explicit request ('מזג את X ל-Y', 'אלה אותה משימה', 'תאחד'). The duplicate's content (comments, attachments, subtasks) moves to the keeper and the duplicate is archived (reversible). Identify both by title.",
  input_schema: { type: "object", properties: {
    keep: { type: "string", description: "Title of the card to KEEP (the primary/keeper)." },
    duplicate: { type: "string", description: "Title of the duplicate card to merge INTO keep and archive." },
  }, required: ["keep", "duplicate"] },
};

export const CORE_TOOLS = [CREATE_CARD_TOOL, CREATE_CARDS_TOOL, UPDATE_CARD_TOOL, LOG_PROGRESS_TOOL, GET_CARD_LINK_TOOL, CREATE_PROJECT_TOOL, MOVE_CARD_TOOL, COMPLETE_CARD_TOOL, ARCHIVE_CARD_TOOL, MERGE_CARDS_TOOL];
// the web /chat set adds calendar management
export const WEB_TOOLS = [...CORE_TOOLS, MANAGE_EVENT_TOOL, SHOW_CARDS_TOOL];
