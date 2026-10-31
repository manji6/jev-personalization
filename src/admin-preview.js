// The review prototype is self-contained, has synthetic data only, and cannot
// connect to APIs or invoke real WebAuthn. Hash the exact inline source blocks.
export async function adminPreviewCSP(html) {
  async function hashes(tag) {
    const matches = [
      ...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")),
    ];
    return Promise.all(
      matches.map(async (m) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(m[1]),
        );
        return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
      }),
    );
  }
  const [scripts, styles] = await Promise.all([
    hashes("script"),
    hashes("style"),
  ]);
  return `default-src 'none'; script-src ${scripts.join(" ")}; style-src ${styles.join(" ")}; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
}
