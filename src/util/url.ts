/** OLLAMA_HOST may be "0.0.0.0:11434", "host:port", or a full URL; normalize to a URL. */
export function normalizeUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, "");
  s = s.replace("://0.0.0.0", "://localhost");
  return s;
}
