export function getBasePath(): string {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BASE_PATH) {
    return process.env.NEXT_PUBLIC_BASE_PATH;
  }
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    return "/admin";
  }
  return "";
}

export function withBasePath(path: string): string {
  if (!path) return "";
  const base = getBasePath();
  if (!base || path.startsWith(base) || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

