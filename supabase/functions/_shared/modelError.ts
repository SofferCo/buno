// buno — turn a failed model call into an HONEST user-facing line.
// "נתקלתי בתקלה זמנית" hid everything: an exhausted API credit balance looked
// identical to a 30-second overload, so 13 messages in a row "failed temporarily"
// while the real cause was permanent. Classify by HTTP status / error type and say
// what's actually wrong (and whether retrying can help).
export function describeModelError(e: any): { text: string; code: string; retryable: boolean } {
  const status = Number(e?.status || e?.statusCode || 0);
  const type = String(e?.error?.error?.type || e?.error?.type || e?.type || "");
  const msg = String(e?.error?.error?.message || e?.error?.message || e?.message || e || "");
  const low = msg.toLowerCase();
  if (status === 400 && /credit balance|billing|purchase credits/.test(low))
    return { code: "credits", retryable: false, text: "יתרת ה-API של Anthropic נגמרה — אני לא יכול לענות עד שנטען קרדיט בקונסול של Anthropic (Plans & Billing). זה לא זמני." };
  if (status === 401 || /invalid x-api-key|authentication/.test(low))
    return { code: "auth", retryable: false, text: "מפתח ה-API של Anthropic לא תקין או בוטל — צריך לעדכן את ANTHROPIC_API_KEY בסודות של Supabase." };
  if (status === 403 || /permission/.test(low))
    return { code: "forbidden", retryable: false, text: "למפתח ה-API אין הרשאה למודל הזה (403) — לבדוק בקונסול של Anthropic." };
  if (status === 429 || type === "rate_limit_error")
    return { code: "rate_limit", retryable: true, text: "הגעתי למכסת הקריאות של Anthropic לדקה הזאת — נסה שוב בעוד דקה." };
  if (status === 529 || type === "overloaded_error" || /overloaded/.test(low))
    return { code: "overloaded", retryable: true, text: "השרתים של Anthropic עמוסים כרגע — נסה שוב בעוד רגע." };
  if (status === 400 && /prompt is too long|too many tokens|context/.test(low))
    return { code: "too_long", retryable: false, text: "השיחה/הלוח גדולים מדי לבקשה אחת (prompt too long) — זו תקלה בצד שלי, לא שלך." };
  if (status === 404 || /not_found|model:/.test(low))
    return { code: "model", retryable: false, text: "המודל שביקשתי לא נמצא (404) — תקלה בהגדרה בצד שלי." };
  if (status >= 500) return { code: "server_" + status, retryable: true, text: "תקלה אצל Anthropic (" + status + ") — נסה שוב בעוד רגע." };
  return { code: type || ("err_" + (status || "unknown")), retryable: true, text: "נתקלתי בתקלה — " + msg.slice(0, 140) };
}
