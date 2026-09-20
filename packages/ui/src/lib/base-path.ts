export function withBasePath(path: string): string {
  if (!path) return "";
  const base = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BASE_PATH) || "";
  if (!base || path.startsWith(base) || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
