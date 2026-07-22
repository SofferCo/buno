export function Stepper({ value, onChange, step = 1, min = 0, sm = false }) {
  return (
    <div className={"adk-stepper" + (sm ? " sm" : "")}>
      <button onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <div className="val">{value}</div>
      <button onClick={() => onChange(value + step)}>+</button>
    </div>
  );
}
