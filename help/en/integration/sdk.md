# SDK tag and optional integrations

Place one shared tag on your site. You aren't required to register a product ID or description for each page. You need permission over the site settings, permission to edit the site where you implement it, and a design for user consent.

## The shared tag

```html
<script
  defer
  src="https://YOUR-API-HOST/sdk.js"
  data-api="https://YOUR-API-HOST"
  data-site="YOUR-SITE-ID"
></script>
```

`defer` downloads the SDK without blocking HTML parsing and runs it after parsing finishes. An inline script right after the tag doesn't wait for the SDK to finish running, so call the consent API after the SDK has finished loading.

Make `data-site` match the site ID in the admin console. Specify an HTTPS origin for the API. HTTP is allowed only for localhost during local development.

"Verification (「動作確認」)" in the admin console also shows a tag example for the selected site. Don't put the Jev API key or an admin token in the tag.

## Start after consent

Call this when you've obtained consent, for example from a CMP, after the SDK has finished loading.

```js
window.JevPersonalization.consent(true);
```

Before consent, observation and normal sending don't start. To withdraw consent:

```js
window.JevPersonalization.consent(false);
```

On withdrawal, the target history in the browser that this SDK uses is also erased.

Only if appropriate consent has already been obtained, you can instead add `data-consent="granted"` to the tag. Don't treat consent as given simply because the tag was loaded.

Calling the API before loading fails, so adjust the order in which your CMP and the tag run. Adapt it to your site's tag manager or SPA setup.

## Admin console settings

- Register your real site's origin under origins.
- Set the paths to collect and the paths to exclude.
- Check the page information and enable metadata sending.
- Create a campaign, set the display target paths and start delivery.

If any of these is disabled or doesn't match, nothing is displayed even if the tag is present.

## Optional events and states

Only names registered in the admin console are accepted. Use them for information you can't tell from page views alone, such as applications, bookings and carts.

```js
// If you registered guide_download in actionNames
window.JevPersonalization.track("guide_download");

// If you registered registered in factNames
window.JevPersonalization.setFact("registered", false);
// When the registration is complete
window.JevPersonalization.setFact("registered", true);
```

An event's value can be omitted, or be a boolean or a finite number. A state is a boolean or a finite number. These APIs are not for passing names, email addresses or form input.

If a campaign's excluded fact is `registered`, an unknown value is not treated as "not registered". Pass false while incomplete and true when complete.

## When it communicates

After consent and loading of the site settings, it requests the initial display decision exactly once for each page to collect. It doesn't wait for the current page's minimum viewing time. In a tab opened in the background, it requests once the tab becomes visible.

| Trigger                               | Communication with the decision API | Update in the browser                                  |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| First display, normal page navigation | Once                                | Reads the current page and the entry page              |
| SPA path change                       | Once for the new page               | Reads the settings, then the current page after 200 ms |
| Reaching the minimum viewing time     | None                                | Saves to the valid view history                        |
| `track()`, `setFact()`                | None                                | Carried to the next page's initial decision            |
| Only a metadata or query change       | None                                | Updates the current page's information                 |
| Time passing, re-running `decide()`   | None                                | Continues measuring and saving                         |

Even if communication fails or the settings version is outdated, the same page is not judged again. A new initial decision happens on the next navigation or reload. The valid view history is used in the next page's decision. Even when a request is sent to the API, nothing is sent to Jev unless the delivery conditions and the required history are met. A campaign decided only by confirmed URL conditions doesn't use Jev either.

## URLs and tracking codes

The current page, the entry page and past valid views keep the URL including its GET parameters. Under "Site settings → Page information fetching → GET parameter keys not to collect", specify one per line the keys you want to remove from saving and sending. If empty, all GET parameters are kept. Everything after `#`, and any username or password in the URL, is always removed.

For example, if you exclude `email`, `?cid=mail_runner&email=a%40example.com` becomes `?cid=mail_runner`. Excluded keys are matched exactly and case-sensitively. If search terms or personal information appear in URLs, exclude the corresponding keys or pages.

## SPAs, CSP and checking

SPA navigation and metadata changes are also observed, but check them against your site's own routing, JSON-LD and CMP.

In your CSP, allow the origins for the SDK script, connections to the API, displayed images and any custom JavaScript modules you need. Set them narrowly to match your site's existing policy.

For the private Preview protected by Access, passing the authentication cookie is explicitly enabled only for same-origin check pages. You don't need this check option when adding it to a normal site, and it doesn't send the authentication cookie to a different origin.
