const FILE_EXTENSION = /\.[a-z0-9]{1,10}$/i;

// SPA fallback guard: requests for file-like paths that don't exist in dist/
// (e.g. /.env, /.git/config, /robots.txt, missing /assets/*.js) must 404
// instead of receiving index.html. A path counts as a file request when any
// segment is a dotfile (starts with ".") or the last segment has a file
// extension — SPA routes never contain dots.
export function isFileRequestPath(pathname: string): boolean {
  const segments = pathname.split("/");
  const last = segments.at(-1) ?? "";
  return (
    FILE_EXTENSION.test(last) ||
    segments.some((segment) => segment.length > 1 && segment.startsWith("."))
  );
}
