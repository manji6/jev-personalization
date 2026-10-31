export function secureOrLoopback(value) {
  try {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" && u.hostname === "localhost"))
    );
  } catch {
    return false;
  }
}
