export async function codeHash(source) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function publicOffer(site, campaign) {
  if (!campaign) return null;
  const offer = {
    id: campaign.id,
    content: campaign.content,
    presentation: campaign.presentation,
    design: site.design,
  };
  if (campaign.presentation.type === "custom" && site.allowCustomJavaScript) {
    const hash = await codeHash(campaign.custom.code);
    offer.custom = {
      modulePath: `/v1/offer-script/${site.id}/${campaign.id}/${hash}.js`,
      variables: campaign.custom.variables,
    };
  }
  return offer;
}
export async function customModule(site, id, hash) {
  const c = site.campaigns.find(
    (c) => c.id === id && c.enabled && c.presentation.type === "custom",
  );
  if (
    !site.allowCustomJavaScript ||
    !c?.custom ||
    (await codeHash(c.custom.code)) !== hash
  )
    return null;
  return c.custom.code;
}
