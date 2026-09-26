import React from "react";

// Severity scale for review items, most to least serious: red → orange → yellow → green.
export const SEVERITY_LEVELS = {
  blocker: { label: "blocker", cls: "sev-blocker" },
  critical: { label: "blocker", cls: "sev-blocker" },
  major: { label: "major", cls: "sev-major" },
  minor: { label: "minor", cls: "sev-minor" },
  nit: { label: "nit", cls: "sev-nit" },
  nitpick: { label: "nit", cls: "sev-nit" },
  trivial: { label: "nit", cls: "sev-nit" },
  info: { label: "info", cls: "sev-nit" },
  suggestion: { label: "nit", cls: "sev-nit" },
};

const TAG_RE = /^\s*\[([a-z]+)\]\s*/i;
const RULE_RE = /^\[([A-Z]{1,4}-\d{1,3})\]\s*/; // optional rule code, e.g. [G-02], [EXP-04]

/** Split "[major][G-02] path — text" into { level, rule, text }. */
export function parseSeverity(item) {
  let text = String(item || "");
  let level = null;
  const tag = text.match(TAG_RE);
  if (tag && SEVERITY_LEVELS[tag[1].toLowerCase()]) {
    level = SEVERITY_LEVELS[tag[1].toLowerCase()];
    text = text.slice(tag[0].length);
  } else if (/^\s*none beyond nits/i.test(text)) {
    level = SEVERITY_LEVELS.nit;
  }
  let rule = null;
  const r = text.match(RULE_RE);
  if (level && r) {
    rule = r[1];
    text = text.slice(r[0].length);
  }
  return { level, rule, text };
}

/** Review item with a coloured severity badge instead of the raw "[major]" prefix. */
export default function SeverityText({ item }) {
  const { level, rule, text } = parseSeverity(item);
  if (!level) return <>{item}</>;
  return (
    <>
      <span className={`badge sev ${level.cls}`}>{level.label}</span>
      {rule ? <span className="sev-rule">{rule}</span> : null} {text}
    </>
  );
}
