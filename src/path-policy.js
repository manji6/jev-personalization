export function pathAllowed(path, site) {
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.includes("..") || /[\\?#%\u0000-\u001f]/.test(decoded))
    return false;
  return (
    site.allowedPathPrefixes.some((p) => decoded.startsWith(p)) &&
    !site.excludedPathPrefixes.some((p) => decoded.startsWith(p))
  );
}
