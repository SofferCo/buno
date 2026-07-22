export function renderMentions(text) {
  return String(text).split(/(\s+)/).map((tok, i) => (tok.startsWith("@") && tok.length > 1) ? <span key={i} className="adk-mention">{tok}</span> : tok);
}
