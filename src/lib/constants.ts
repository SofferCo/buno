export const KEY = "buno_board_v1";

export const APREFIX = "buno_asset_";

export const DEFAULT_COLUMNS = [
  { id: "col-brief", title: "בריף חדש" },
  { id: "col-doing", title: "בעבודה" },
  { id: "col-review", title: "לבדיקה / אישור" },
  { id: "col-done", title: "הושלם" },
];

export const SWATCHES = ["#0E8F8C", "#3B6FE0", "#8E54C4", "#D9503A", "#C9821A", "#2E9E5B", "#455A64"];

export const PRIORITY = {
  regular:   { label: "רגיל",  color: "#647079", soft: "#EEF1F2" },
  important: { label: "חשוב",  color: "#C9821A", soft: "#FBF0DC" },
  critical:  { label: "קריטי", color: "#D9503A", soft: "#FBE2DC" },
};

export const PRI_ORDER = { critical: 0, important: 1, regular: 2 };

export const AV_COLORS = ["#0E8F8C", "#8E54C4", "#3B6FE0", "#2E9E5B", "#C9821A", "#D9503A", "#16A085", "#6C7BE0", "#7A57D1", "#2E86C1", "#E67E22", "#CB4B7A", "#4FB0AD", "#5D6D7E"];

export const ROUTINE_LABEL = { daily: "יומית", weekly: "שבועית", monthly: "חודשית" };

export const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export const HE_WD = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export const DONUT_COLORS = ["#0E8F8C", "#8E54C4", "#3B6FE0", "#2E9E5B", "#C9821A", "#D9503A", "#4FB0AD", "#6C7BE0", "#7BC77A", "#E0A24F", "#455A64"];
