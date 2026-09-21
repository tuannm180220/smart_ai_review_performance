const SECRET_KEYS = /token|password|api[_-]?key|secret|authorization/i;

function redact(value) {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function formatArgs(args) {
  return args.map((a) => {
    if (a instanceof Error) return a.message;
    if (a && typeof a === "object") {
      try {
        return JSON.stringify(redact(a));
      } catch {
        return String(a);
      }
    }
    return a;
  });
}

export function log(...args) {
  console.log(new Date().toISOString(), "-", ...formatArgs(args));
}

export function logError(...args) {
  console.error(new Date().toISOString(), "-", ...formatArgs(args));
}
