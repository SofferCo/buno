# buno

עוזר אישי לניהול חיים (Vite + React + TypeScript, Supabase, Claude API).
פרויקט Supabase: `qzzvbhosergywxellbzl`.

## פונקציות Edge (פריסה)

```bash
supabase functions deploy chat        --project-ref qzzvbhosergywxellbzl
supabase functions deploy gmail-scan  --project-ref qzzvbhosergywxellbzl
supabase functions deploy morning-sweep --project-ref qzzvbhosergywxellbzl
```

הגדרות `verify_jwt` לכל פונקציה ב‑`supabase/config.toml` (ל‑`morning-sweep` הוא `false` — היא מגודרת ב‑`CRON_SECRET`, לא ב‑JWT).

> **כלל עבודה:** כל commit שנוגע ב‑`supabase/functions/**` — לפרוס מיד (`supabase functions deploy …`), או לציין במפורש "לא פרוס" בהודעת הסיום.

## ה‑morning sweep (cron לילי)

`morning-sweep` היא הסריקה הלילית: לכל משתמש עם Google מחובר היא עוברת על המייל/יומן וכותבת snapshot אחד ליום לשרשור השיחה (`door='sweep'`), עם טיוטות לאישור. היא רצה דרך **pg_cron** (מיגרציה `0012`), ברירת מחדל **04:00 כל יום** (`0 4 * * *`).

⚠️ **ה‑cron לא מופעל אוטומטית.** המיגרציה יוצרת את הפונקציה `schedule_morning_sweep(...)` אך **לא קוראת לה** (כדי לא להכניס את הסוד ל‑repo). צריך להריץ אותה ידנית פעם אחת עם הסודות.

### נאדג'ים וגילאי תזוזה (מיגרציה 0013)

חוק הקאיזן משתמש ב‑`card.column_changed_at` כדי לדעת מתי כרטיס זז עמודה לאחרונה. מיגרציה `0013` הוסיפה את העמודה ואת ה‑trigger ש**מתחזק** אותה — אבל לכרטיסים שקדמו למיגרציה בוצע **backfill ל‑`created_at`**. לכן: גילאי התזוזה אמינים **רק מרגע החלת המיגרציה והלאה**. כרטיסים ותיקים ייראו כאילו "זזו לאחרונה" בתאריך היצירה שלהם עד שיזוזו בפועל פעם ראשונה (שאז ה‑trigger יעדכן לזמן אמת). זו הסיבה שאחרי המיגרציה כמה כרטיסים עלולים להיראות "פתוחים N ימים" באותו גיל אחיד — ארטיפקט חד‑פעמי של ה‑backfill, לא באג. חוקי הנאדג' מחריגים כרטיסים בלי כותרת, כך שכרטיס ריק לעולם לא ייחשף בהודעה.

### איך מאמתים שה‑cron חי

ב‑Supabase SQL Editor:

```sql
-- האם ה‑job רשום ופעיל? מצופה: שורה אחת, schedule '0 4 * * *', active = t
select jobid, jobname, schedule, active
from cron.job
where jobname = 'morning-sweep';

-- הרצות אחרונות (הצלחה/כשל)
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'morning-sweep'
order by d.start_time desc
limit 5;
```

אם השאילתה הראשונה מחזירה **0 שורות** — ה‑cron לא רשום, וה‑sweep לא רץ.

### איך מפעילים / מפעילים מחדש

ב‑SQL Editor (הסוד נשאר מחוץ ל‑repo). `CRON_SECRET` = אותו ערך שמוגדר כ‑secret של פונקציות ה‑Edge; `ANON_KEY` = ה‑anon/publishable key של הפרויקט:

```sql
select schedule_morning_sweep('<CRON_SECRET>', '<ANON_KEY>', '0 4 * * *');
```

הפונקציה idempotent — היא מוחקת ורושמת מחדש את ה‑job בשם `morning-sweep`. לשינוי שעה — להחליף את ביטוי ה‑cron.

### בדיקה ידנית (עוקף את ה‑cron)

```bash
curl -X POST 'https://qzzvbhosergywxellbzl.supabase.co/functions/v1/morning-sweep' \
  -H 'Content-Type: application/json' \
  -H 'x-cron-secret: <CRON_SECRET>' \
  -d '{}'
```

להרצה על משתמש בודד (לבדיקה): `-d '{"userId":"<uuid>"}'`. תשובה תקינה: `{"ran":N,"results":[…]}`. אם חוזר `403 forbidden` — ה‑`x-cron-secret` לא תואם ל‑secret של הפונקציה.
