# FAQ

## Do I need to configure each page?

The shared tag automatically fetches the basic page information. There is no required per-page setting. Do check the contents of your JSON-LD and metadata.

## Is the raw number of seconds on a page treated as interest?

Display time is an observed value. The API selects the views that met the minimum time, and interest is judged using context such as the page as well. It is not a conversion where longer means a higher purchase probability.

## Does AI write the offer text?

No. Text, images and JavaScript are registered in advance. The judgment questions built from your input are also assembled from a fixed template.

## Is "what you want to tell them" the same as the display title?

The former is input that describes the context for judging. The display title is the wording actually shown. The campaign name is yet another, administrative, name.

## Can one user work on several sites?

Yes. One account can belong to several sites and switch between them in the header. Permissions may differ from site to site.

## Are invitation emails sent automatically?

In the initial version, you share the link manually. It is a separate feature from the email codes Cloudflare Access sends for entry.

## Is the admin token no longer needed?

It is used for the first superuser registration in production. It isn't used as a shared password after migration, or as a back door for recovery. It isn't needed for the first registration in a Preview linked to Access.

## Is the display count shared across all devices?

No. It is based on the valid history in the browser. It is not a scheme that tracks all devices with a server-side visitor ID.

## Can I use a Preview passkey in production?

The origin and the database differ, so the same registration isn't carried over as it is. You register separately in production.

## Does production always need Access too?

The preview environment is protected by Access this time. The production admin console is protected by the app's passkeys and permissions, and you can also combine Access or similar as needed. Don't confuse it with the public scope of the delivery API.

## Where can I see results or purchase rates?

Result aggregation and A/B tests are not provided at the moment. The home screen shows the setup status. It doesn't present Jev's judgment score as a result.

## Where can I edit Help?

It is the Markdown under `help/` in the GitHub repository. You can suggest changes from each page's edit link, or through Issues. For the publishing steps, see [maintaining the Help site](../operations/help-site).

## Can I use a different Jev API key per site?

Yes. Site admins and superusers can set it in [Jev connection](../guides/jev). It is stored encrypted and the value is never shown again. You can also see the number of real Jev calls started, their results and latency, but this is not billing data.
