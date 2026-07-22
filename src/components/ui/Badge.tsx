import { initials } from "../../lib/people";

export function Badge({ client, size = 36 }) {
  return <div className="adk-cbadge" style={{ width: size, height: size, background: client?.color || "#647079", fontSize: size * 0.4 }}>
    {client?.logo ? <img src={client.logo} alt="" /> : (client?.home ? "🏠" : initials(client?.name))}
  </div>;
}
