// buno — version switch for the assistant's voice and reasoning depth.
//
//   v1 = the original: terse, effort "low", a brief that recites computed
//        metrics. Precise, but cold — "a report, not a friend."
//   v2 = the warm rewrite (2026-08): the "most practical friend" voice,
//        effort "high" so it can actually think and talk, and a morning brief
//        that is *synthesized* like a friend handing you the day, not recited.
//
// BOTH versions live in the code. Roll back instantly by setting the
// BUNO_VERSION env var to "v1" in the Supabase dashboard and redeploying —
// nothing is lost, and the switch is one value.
export type BunoVersion = "v1" | "v2";

export const BUNO_VERSION: BunoVersion =
  (Deno.env.get("BUNO_VERSION") === "v1" ? "v1" : "v2"); // default: v2

// Reasoning depth. v1 ran the live conversation at "low" — the single biggest
// cause of the flat, clipped, "analytical-not-human" feel. v2 gives it room.
export const CHAT_EFFORT: "low" | "medium" | "high" =
  BUNO_VERSION === "v2" ? "high" : "low";

export const BRIEF_EFFORT: "low" | "medium" | "high" =
  BUNO_VERSION === "v2" ? "high" : "low";
