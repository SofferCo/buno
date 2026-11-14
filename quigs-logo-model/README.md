# quigs-logo-model — מערכת ליצירת לוגואים גיאומטריים של חיות

מערכת שמייצרת לוגואים בסגנון הסרטונים (`quigs-32`): סילואטה שחורה, גיאומטרית, מינימליסטית,
עם חיתוכי "חלל שלילי" (negative space), על רקע אחיד, ובסוף כרטיס ממותג עם שם + ®.

```
quigs-logo-model/
├── dataset/                 הדאטה שחולץ אוטומטית מ-32 הסרטונים
│   ├── logos/               32 לוגואים נקיים, שחור על לבן, 1024×1024 (תמונות האימון)
│   ├── svg/                 אותם לוגואים כווקטור (potrace)
│   ├── captions/            כיתוב לכל תמונה (trigger word: QUIGS)
│   ├── pairs/               תמונה מקורית → סילואטה על התמונה → כרטיס → כרטיס ממותג (מוקטן)
│   ├── palette.json         צבע רקע + צבע לוגו של כל כרטיס ממותג בסרטונים
│   ├── manifest.json        מטא-דאטה: split (train/holdout), זמני הפריימים, bbox
│   └── preview/             contact sheets לבדיקה בעין
├── captions.json            הכיתובים (אפשר לערוך ולהריץ שוב)
├── scripts/
│   ├── extract_dataset.py   סרטונים → dataset/ (זיהוי אוטומטי של שלבי הסרטון)
│   ├── prepare_training_data.py  dataset/ → תיקיית אימון (+ שיקוף אופציונלי)
│   ├── generate.py          FLUX + LoRA → לוגו נקי + SVG (+ כרטיס)
│   ├── logo_post.py         ניקוי רסטר → מסכה → SVG
│   └── make_card.py         לוגו + שם + צבעים → הכרטיס הממותג מסוף הסרטון
└── train/
    ├── flux_lora.yaml       קונפיג ai-toolkit ל-LoRA על FLUX.1-dev
    └── run_cloud.sh         סקריפט אימון מלא למכונת GPU בענן
```

## מה כבר נעשה (רץ בלי GPU)

1. **חילוץ הדאטה** – כל סרטון עובר אותו תסריט: תמונה → עיגולים וקווי בנייה → קו מתאר אדום →
   סילואטה שחורה על התמונה → לוגו על כרטיס אחיד → כרטיס עם שם המותג.
   הסקריפט מזהה את הפריימים "השטוחים" (רקע אחיד) בסוף הסרטון, שולף את הכרטיס הראשון בלי טקסט,
   מנקה קווי עזר ושאריות טקסט (רכיבים מחוברים + morphology), ומנרמל לשחור-על-לבן מרובע.
2. **וקטוריזציה** – כל לוגו עבר potrace ל-SVG, וזה אותו מסלול שהפלט של המודל יעבור.
3. **כיתובים** – 32 כיתובים ידניים עם trigger word `QUIGS`, תנוחה/זווית לכל חיה.
4. **פיצול** – 27 לאימון, 5 holdout (fox, horse, serval, gazelle, bear) שאף פעם לא נכנסים לאימון,
   כדי שאפשר יהיה להשוות "המודל נגד המקור" על חיות שהוא לא ראה.
5. **כרטיס ממותג** – `make_card.py` משחזר את הכרטיס מסוף הסרטון (נבדק על הדוב והעיט).

## אימון (דורש GPU עם 24GB+)

הגישה: **style LoRA על FLUX.1-dev** עם [ai-toolkit](https://github.com/ostris/ai-toolkit).
27 תמונות (54 עם שיקוף) מספיקות ל-LoRA סגנוני; 2000 צעדים, rank 16, lr 1e-4, דגימות כל 250 צעדים.

על מכונה בענן (RunPod / Lambda / Vast / Higgsfield rental), עם H100 זה ~45 דקות, L40S ~1.5 שעות:

```bash
# פעם אחת: לאשר את רישיון FLUX.1-dev ב-huggingface.co/black-forest-labs/FLUX.1-dev
export HF_TOKEN=hf_...
git clone <repo> && bash buno/quigs-logo-model/train/run_cloud.sh buno/quigs-logo-model
```

הסקריפט משכפל את ai-toolkit, בונה `train_data/` מ-`dataset/` (train בלבד), ומריץ את
`train/flux_lora.yaml`. ה-LoRA נשמר ב-`output/quigs_logo_flux_lora/*.safetensors`,
ודגימות ביניים (סוס, שועל, דוב, ינשוף) ב-`output/.../samples/`.

ידנית, אם כבר יש ai-toolkit מותקן:

```bash
python3 scripts/prepare_training_data.py --dataset dataset --out /path/ai-toolkit/train_data --mirror
cp train/flux_lora.yaml /path/ai-toolkit/train/
cd /path/ai-toolkit && python run.py train/flux_lora.yaml
```

### איך יודעים שזה עובד

```bash
python3 scripts/generate.py --lora output/quigs_logo_flux_lora/quigs_logo_flux_lora.safetensors --holdout
```

מייצר את 5 חיות ה-holdout ובונה `out/holdout_sheet.png`: עמודה שמאלית = הלוגו האמיתי מהסרטון,
לידו 4 וריאציות של המודל. אם ה-LoRA "מצייר" סילואטות שטוחות עם חיתוכי negative space ולא
איורים מצוללים – הסגנון נתפס. אם הוא משחזר כמעט בדיוק את חיות האימון – overfit, לקחת checkpoint מוקדם יותר (1250–1500).

## שימוש (אחרי האימון)

```bash
python3 scripts/generate.py --lora quigs_logo_flux_lora.safetensors "an owl perched in side profile" --n 4
python3 scripts/generate.py --lora ... "a wolf howling in side profile" --name "Howlr" --bg "#07142f" --fg "#dceffb"
```

לכל תוצאה: `out/<slug>_<seed>.png` (שחור על לבן נקי), `.svg` (וקטור), ו-`_card.png` אם ניתן שם.
צבעי מותג לדוגמה נמצאים ב-`dataset/palette.json` (32 זוגות רקע/לוגו מהסרטונים).

## הערות

- הפלט של המודל הוא רסטר; `logo_post.py` מנקה אותו (סף, פתיחה מורפולוגית, סינון רכיבים) ומוקטר ל-SVG,
  כך שהתוצאה הסופית ניתנת לעריכה באילוסטרייטור כמו המקור.
- הסרטונים עצמם לא ב-repo (60MB). להרצת החילוץ מחדש:
  `python3 -I scripts/extract_dataset.py <dir-with-mp4s> --out dataset --captions captions.json`
- הלוגואים בסרטונים הם עבודה של מעצב/ת אחר/ת. אימון על סגנון הוא בסדר מבחינה טכנית, אבל
  שימוש מסחרי בלוגואים שנראים קרובים מדי למקוריים (למשל אותו דוב) – כדאי להימנע ממנו.
- אלטרנטיבה בלי אימון: אותם כיתובים + 3–4 לוגואים מ-`dataset/logos` כרפרנס במודל תמונה מסחרי
  (gpt-image / Nano Banana) נותנים תוצאה סבירה, ו-`logo_post.py` מנקה אותה לאותו פורמט.
