// id generation. In cloud mode every entity id must be a uuid (DB primary
// keys) — EXCEPT columns, whose state id is a semantic key ("col-brief",
// "col-xyz") that app logic targets directly; the DB row uuid lives only in
// the sync layer's colMap.
let uuidMode = false;
export function setUidMode(mode: "local" | "uuid") { uuidMode = mode === "uuid"; }
export function uid(p) {
  if (uuidMode && p !== "col") return crypto.randomUUID();
  return p + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}
