import { initials, nameColor } from "../../lib/people";

export function Avatar({ name, size = 24 }) { return <div className="adk-av" style={{ width: size, height: size, background: nameColor(name), fontSize: size * 0.4 }} title={name}>{initials(name)}</div>; }
