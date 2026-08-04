// buno — /invite-email: send a board-invite email via Resend. Inert until
// RESEND_API_KEY is set and the sending domain is verified. The inviter must be
// authenticated (JWT), so we never send on behalf of an anonymous caller.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "missing authorization" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return json({ error: "not authenticated" }, 401);

  let body: any; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const to = String(body?.to || "").trim();
  const boardName = String(body?.boardName || "הבורד");
  const inviter = String(body?.inviter || "מישהו").trim() || "מישהו";
  const link = String(body?.link || "").trim();
  const role = String(body?.role || "member");
  if (!to || !link) return json({ error: "missing to/link" }, 400);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ sent: false, reason: "no_resend_key" }); // inert until configured — the copy-link still works
  // buno.io is verified in Resend → send from invite@buno.io by default (override
  // with INVITE_FROM if ever needed).
  const from = Deno.env.get("INVITE_FROM") || "buno <invite@buno.io>";
  const roleHe = role === "viewer" ? "צופה" : role === "owner" ? "בעלים" : "חבר צוות";

  // clean, Ink-on-white, RTL — buno brand.
  const html = `<div dir="rtl" style="font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#ffffff;color:#1A1A1A;max-width:480px;margin:0 auto;padding:32px 28px;">
  <div style="font-weight:800;font-size:22px;letter-spacing:-.5px;">buno</div>
  <p style="font-size:16px;line-height:1.65;margin:22px 0 6px;"><b>${esc(inviter)}</b> הזמין אותך להצטרף אל הבורד <b>${esc(boardName)}</b> ב־buno, בתור ${roleHe}.</p>
  <p style="font-size:14px;color:#6b6b6b;margin:0 0 24px;">buno הוא העוזר האישי שמחזיק את כל מה שחשוב לך במקום אחד.</p>
  <a href="${esc(link)}" style="display:inline-block;background:#1A1A1A;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:12px;">הצטרף לבורד</a>
  <p style="font-size:12px;color:#9a9a9a;margin:26px 0 0;line-height:1.6;">אם הכפתור לא עובד, העתק את הקישור:<br><span dir="ltr" style="color:#6b6b6b;">${esc(link)}</span><br>ההזמנה תקפה 14 יום ומקושרת לכתובת המייל הזו.</p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: `${inviter} הזמין אותך לבורד "${boardName}" ב־buno`, html }),
    });
    if (!res.ok) { const t = (await res.text()).slice(0, 300); console.error("resend failed", res.status, t); return json({ sent: false, error: t }, 502); }
    return json({ sent: true });
  } catch (e) { return json({ sent: false, error: String((e as any)?.message || e) }, 502); }
});
