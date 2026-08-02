const validationOrigin = "https://app.local";

/** Returns a normalized same-origin path or the workspace root. */
export function safeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const target = new URL(value, validationOrigin);
    if (target.origin !== validationOrigin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
