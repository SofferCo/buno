// buno — cloud asset storage for card attachments.
// Bucket: "attachments" (private). Object path: <project_id>/<card_id>/<att_id>
// — the first segment drives the storage RLS policies (0005): read for project
// members, write/delete for owner+member.
//
// Display strategy: the app's `assets` map keeps working exactly as before —
// components read assets[attId] as an <img>/<a> src. Locally that's a dataURL;
// for cloud-stored files we drop a signed URL (12h) into the same map.
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "attachments";
const SIGNED_TTL = 60 * 60 * 12;

export const assetKey = (projectId: string, cardId: string, attId: string) =>
  `${projectId}/${cardId}/${attId}`;

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return await (await fetch(dataUrl)).blob();
}

// Upload a dataURL; returns the storage key, or null on failure (the
// attachment then simply stays local-only — same behavior as before).
export async function uploadAsset(
  sb: SupabaseClient, projectId: string, cardId: string, attId: string, dataUrl: string
): Promise<string | null> {
  try {
    const key = assetKey(projectId, cardId, attId);
    const blob = await dataUrlToBlob(dataUrl);
    const { error } = await sb.storage.from(BUCKET).upload(key, blob, {
      contentType: blob.type || "application/octet-stream", upsert: true,
    });
    return error ? null : key;
  } catch { return null; }
}

export async function removeAsset(sb: SupabaseClient, storageKey: string) {
  try { await sb.storage.from(BUCKET).remove([storageKey]); } catch {}
}

// Signed URLs for every cloud-stored attachment that has no local copy.
// Returns { attId: url }. Batched in one API call.
export async function signMissingAssets(
  sb: SupabaseClient, cards: Record<string, any>, have: Record<string, string>
): Promise<Record<string, string>> {
  const wanted: { attId: string; key: string }[] = [];
  for (const c of Object.values(cards) as any[])
    for (const a of c.attachments || [])
      if (a.storageKey && !have[a.id]) wanted.push({ attId: a.id, key: a.storageKey });
  if (!wanted.length) return {};
  const { data, error } = await sb.storage.from(BUCKET)
    .createSignedUrls(wanted.map((w) => w.key), SIGNED_TTL);
  if (error || !data) return {};
  const byKey = new Map(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  const out: Record<string, string> = {};
  for (const w of wanted) { const u = byKey.get(w.key); if (u) out[w.attId] = u; }
  return out;
}
