# Data collected and sent

## What is observed automatically

Observation happens on collected pages, with the user's consent and with metadata sending enabled in the site settings. The keys below are the names the SDK holds and uses in decision requests to your own API.

| Observed value   | Key                       | Source and unit                                                                                 |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Page path        | `page.path`               | `location.pathname` of the current URL. Example: `/products/polo`                               |
| Page name        | `page.name`               | A string taken in the priority order below                                                      |
| Page description | `page.description`        | A string taken in the priority order below. The key is omitted if nothing is found              |
| Page type        | `page.type`               | A custom JSON-LD candidate, or `@type` in legacy mode. Omitted in standard mode                 |
| Page themes      | `page.themes`             | Taken from a custom JSON-LD candidate or legacy mode. Omitted in standard mode                  |
| Time visible     | `visibleMs`               | Cumulative milliseconds per page. Time while the tab is hidden or after `pagehide` is not added |
| Order of views   | Array order of `visits[]` | From the oldest view to the newest. The latest 50 are kept                                      |

`visibleMs` is time based on the tab's visibility state. It is not a value that confirms the time actually read or gazed at. The limit per entry is 86,400,000 milliseconds. The date and time of each view, visit IDs and scroll amounts are not recorded.

Page information is used for `currentPage`, for the initial decision, and for `visits[].page`, for views that met the minimum viewing time. For the page at entry, `path`, `name` and `url` are saved to `entryPage`.

### Page URL and excluded keys

`page.url` is taken from `location.href`. It includes GET parameters, and if the exclusion setting is empty, all of them are kept. A username, password and anything after `#` in the URL are always removed. `path` is the path only, as before.

In **GET parameter keys not to collect** under "Site settings → Page information fetching", you can specify up to 50 keys to exclude, each up to 100 characters. The match is exact and case-sensitive, against the URL-decoded key. If the same key appears several times, all are removed. The order and encoding of the parameters that remain are preserved.

Example: if the excluded keys are `email` and `token`, the URL saved and sent from `https://example.com/polo?cid=mail_runner&email=a%40example.com&token=x#size` is `https://example.com/polo?cid=mail_runner`. `Email` is a different key from `email`. A URL is limited to 4,096 characters. If it is longer, the URL field is omitted and the path and name are kept.

Exclusion is applied in the SDK before saving, normal sending and diagnostic recording, and your own API checks it again. A URL condition that uses an excluded value is not met. Search terms or personal information in a URL are not detected automatically. If personal information is in the path, set an excluded path.

`entryPage` is the first collected page observed in this tab after consent. It isn't inferred from entries before consent or from the HTTP Referer. Even if a later page has no `cid`, the `cid` of the saved entry page can still be judged.

### Choose how it is fetched per site

A site admin or superuser can change it under "Site settings → Page information fetching". A new site is in standard mode. An existing site with no fetching settings keeps the previous JSON-LD-first behavior until you switch and save.

### Standard mode fetching priority

| Value              | First candidate                                                                 | Second candidate                                                          | If it can't be obtained |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------- |
| `page.name`        | `content` of `meta[property="og:title"]` or `meta[name="og:title"]`             | The HTML `title`                                                          | `Untitled`              |
| `page.description` | `content` of `meta[property="og:description"]` or `meta[name="og:description"]` | `content` of `meta[name="description"]` or `meta[property="description"]` | The key is omitted      |
| `page.type`        | Not fetched                                                                     | —                                                                         | The key is omitted      |
| `page.themes`      | Not fetched                                                                     | —                                                                         | The key is omitted      |

The name and the description are each evaluated in their own order. If a value is empty, isn't a string or matches the common exclusion patterns, it moves on to the next candidate. Standard mode doesn't read JSON-LD. It examines up to 200 meta elements and uses only the first element for the same key.

### Custom mode fetching priority

Candidates arranged in the admin console are evaluated from the top, and the first candidate that satisfies its conditions and has a page name is adopted. There are at most 10 candidates, and each candidate has at most 5 conditions.

For example, you can set this order.

| Order | Condition                                                                    | Page name                                        | Description                       |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| 1     | JSON-LD `@type` contains `Product`, and `sku` of the same object has a value | `Product details: ` + `name` of the same JSON-LD | `description` of the same JSON-LD |
| 2     | `og:title` has a value                                                       | `og:title`                                       | `og:description`                  |
| 3     | The HTML title has a value                                                   | The HTML title                                   | meta description                  |

`Product` is the schema.org standard. It isn't automatically converted to `Products` or `ProductGroup`. For conditions, you can choose AND/OR and "has a value", "has the property", "equals" and "array contains / string matches". 0 and false exist as values. "Equals" and "contains" are exact matches of the stringified value, not partial matches.

You can choose the source and key for the page name and description, and a prefix to put before the fetched value. If a description can't be found, specify either "adopt without a description" or "move on to the next candidate". If no candidate can be used, the current `path` and `name: "Untitled"` are kept and the description is omitted.

JSON-LD conditions and fetched values are evaluated on the same object. If there are several candidates, it looks for a unique target in this order: the mainEntity of a WebPage that matches the current page, then a url/mainEntityOfPage tied to the current page. If it can't be determined, it moves on to the next candidate. It doesn't pick the first product automatically.

Only when a JSON-LD candidate is adopted, the first string of that candidate's `@type` is used for `page.type`, and `articleSection ?? keywords` for `page.themes`. Themes are a string or an array of strings split by commas, up to 8. It doesn't switch from an empty articleSection to keywords, and it doesn't remove duplicates. For candidates that use only meta tags or the title, type and themes are omitted.

JSON-LD is read from the first 10 scripts, each at most 100,000 characters, with a search depth of 8 and at most 200 objects. It examines the top level, arrays, @graph and mainEntity, and doesn't expand inside itemListElement or follow external references. A key is a simple property reference of up to 6 levels and 120 characters. Expressions, arbitrary JavaScript and DOM selectors can't be used. Properties used only to check conditions, such as sku, are not added to the API automatically.

### Common formatting and exclusion

Limits are 160 characters for the name, 400 for the description, 80 for the type and 80 for each theme. Consecutive spaces and line breaks become a single space, leading and trailing spaces are removed, and the text is cut at the limit. After that, strings that match an email format, or a run of 9 or more digits, including forms separated by spaces or hyphens, are excluded. The same check applies to a custom prefix.

This check alone doesn't remove all personal information. Exclude pages that contain names, addresses or personal metadata from the collected paths.

### Changing settings and checking on a real page

The SDK itself is common. The saved per-site rules are applied the next time the settings are fetched, so you don't need to replace the tag. It isn't a mechanism that reflects changes immediately in a tab that is already open. If the fetching rule version differs at decision time, the decision isn't passed on to Jev and is held, and the new SDK fetches the settings again and updates the local data. The decision request for the same page is not sent again.

When the rule version changes, the earlier browsing history in the browser is discarded and the current page is taken again. The displayed state and the permitted events and confirmed states are kept. An old SDK can't interpret the new settings, so a reload after the cache updates is needed.

If you enter a URL on the right, you can receive the result and reasons from the SDK in another tab. You can check even an unsaved draft of the settings. It requires measurement consent, the latest SDK and metadata sending enabled for the site. During a check, normal judgment, offer display and saving history are not performed. For details, see [site settings](../guides/sites#fetching-page-information-and-checking-on-a-real-page).

::: details The previous specification for existing sites without fetching settings

### Legacy mode fetching priority

First, one JSON-LD object that represents the page is chosen by the rules described below. Each field uses a property of that object.

| Field         | Order of fetching                                                               | Limit and when there is no value                                                          |
| ------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `name`        | JSON-LD `name` → `headline` → `title` → meta `og:title` → HTML `document.title` | Up to 160 characters. `"Untitled"` if no usable string is left                            |
| `description` | JSON-LD `description` → meta `og:description` → meta `description`              | Up to 400 characters. The key is omitted if there is no usable string                     |
| `type`        | The matching type from the selected JSON-LD `@type`                             | JSON-LD only. There is no fallback to `og:type` or similar                                |
| `themes`      | JSON-LD `articleSection` → `keywords`                                           | Up to 80 characters each, up to 8. JSON-LD only. `meta keywords` and similar are not used |

Meta information targets both `meta[property="key"]` and `meta[name="key"]`, and uses the `content` of the first matching element in the document. For example, `og:title` can be taken from `<meta property="og:title" content="…">` or `<meta name="og:title" content="…">`. Multiple elements with the same key are not combined.

**It moves on to the next candidate only when the previous value does not exist or is `null`.** Even if the value is an empty string, a non-string such as an array, or matches the exclusion patterns described later, it doesn't move on. For example, if the JSON-LD has `"name": ""`, `name` becomes `"Untitled"` even when an OGP title exists.

`themes` accepts a string or an array of strings, splits it by a half-width comma `,` and formats it. `articleSection` and `keywords` are not combined. If `articleSection` is an empty string or an empty array, it doesn't move on to `keywords` either. Themes are not de-duplicated.

### Legacy mode JSON-LD object selection

The target is `script[type="application/ld+json"]`. The first 10 are read, and any that exceeds 100,000 characters or can't be parsed as JSON is skipped. The search also has limits such as depth.

The supported `@type` values are these 9. They are matched as exact strings. If several types are specified in an array, **the first matching type in the array's order** is adopted.

`WebPage`, `Article`, `NewsArticle`, `BlogPosting`, `Product`, `Service`, `JobPosting`, `Course`, `Event`

The object is chosen in this order.

1. Look for a `WebPage` whose `url` or `@id` matches the current page. If none matches and there is exactly one `WebPage`, use it.
2. If the chosen `WebPage`'s `mainEntity` is a supported type, use it as the representative of the page. A reference by `@id` is resolved to the object with the same `@id` inside the loaded JSON-LD.
3. If that can't be used, look for a supported non-`WebPage` object whose `url` or `mainEntityOfPage` matches the current page.
4. If none is found, use the `WebPage` chosen in step 1.
5. If there is none, and there is exactly one supported object other than `WebPage`, use it. If there are several and it can't be determined, no JSON-LD representative is chosen, and each field moves on to its OGP, HTML or other candidates.

URL matching is decided by origin and path. Differences in the query, fragment and trailing `/` are not used. A relative URL is also interpreted against the current page. If several match, the first in search order is used. `mainEntityOfPage` supports a URL string or the form `{"@id":"…"}`.

What is searched is the top-level objects and arrays of the JSON-LD, and their `@graph` and `mainEntity`. Products and the like inside `itemListElement` are not searched. There is no process that accesses external URLs to resolve references.

### String formatting and exclusion

For the name, description and each theme, consecutive spaces and line breaks become a single space, leading and trailing spaces are removed, and the text is cut to the limit. After that, strings that match an email format, or a run of 9 or more digits, including forms separated by spaces or hyphens, are not adopted.

This pattern check alone can't detect all personal information. If you put names, addresses or personal information in a page's metadata, you need to take measures such as excluding it from collection.

### Example

The current URL is `https://example.com/products/polo?from=mail#size`, and the following JSON-LD is present.

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "吸汗速乾ポロシャツ",
  "description": "さらりと着られる夏向けのポロシャツ",
  "keywords": "吸汗速乾,ポロシャツ",
  "offers": { "@type": "Offer", "price": "3980", "priceCurrency": "JPY" }
}
```

The fetched `page` has this form. `offers.price` and `priceCurrency` are not fetched. The following is an illustrative example, not a measurement from a real site.

```json
{
  "url": "https://example.com/products/polo?from=mail",
  "path": "/products/polo",
  "name": "吸汗速乾ポロシャツ",
  "description": "さらりと着られる夏向けのポロシャツ",
  "type": "Product",
  "themes": ["吸汗速乾", "ポロシャツ"]
}
```

Image URLs, prices, stock, breadcrumbs, heading text, the full text of the page and JSON-LD `about` and similar are not used by this automatic extraction. For business states such as applications, bookings and carts, and for custom clicks, explicitly pass the names and values you registered in [optional integrations](./sdk).

:::

## What is stored in the browser

The following values are saved in sessionStorage under `jev:v1:<site ID>`. The key name is kept for compatibility, and the internal `version` is 2. Measurement of the current page is saved in `currentVisit: {page, visibleMs}` and is added to `visits` once it becomes a valid view. `entryPage` stores the entry page, and `urlPolicyRevision` stores the version of the URL exclusion settings. If the site ID is `demo`, the storage key is `jev:v1:demo`.

| Key        | Value stored                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `visits`   | An array of `page` and `visibleMs` that met the minimum viewing time                               |
| `actions`  | An array of `{name, value}` passed through optional integrations. `{name}` if the value is omitted |
| `facts`    | A map of state names passed through optional integrations to boolean or finite number values       |
| `delivery` | `{shown, dismissed}` per campaign ID: the number of successful displays and whether it was closed  |
| `updated`  | The last save time, in milliseconds from `Date.now()`                                              |

On reload, saved data whose `updated` is 30 minutes or more old is not restored, and the data is validated again against the currently allowed paths, event names, state names and so on. It isn't a scheme that stores each view's date and time and deletes them after 30 minutes. Another tab or device is not linked as one visitor.

The display limit is not a permanent limit across all devices. It is a limit against the valid history in the browser.

The fetching rule version is kept together with the history as `metadataRevision`. For legacy mode it is `legacy`, and for standard and custom it is a hash of the fetching settings (a 32-character hexadecimal string). When the version changes, the previous `visits` are discarded.

## What is sent to your own API at decision time

The JSON body of `POST /v1/decision?siteId=<site ID>` carries these keys. Sending happens only at decision time.

| Key        | Contents                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `siteId`   | The site ID given in `data-site` of the shared tag                                                             |
| `visits`   | Browsing history. Each element is `{page, visibleMs}`. Past valid views only. The current page is not included |
| `actions`  | Actions passed through optional integrations under permitted names. Up to the latest 30                        |
| `facts`    | States passed through optional integrations under permitted names                                              |
| `delivery` | Displayed and closed state per campaign ID                                                                     |

The new SDK also sends `protocolVersion: 2`, `currentPage`, an optional `entryPage`, the URL exclusion settings version `urlPolicyRevision` and the fetching rule version `metadataRevision`. These are values for the API to check against the current versions, and they are not sent to Jev. The source of each value and the reason a candidate was adopted are also not included in normal decision requests or in what goes to Jev.

`updated` is not sent. The source information (`sources`) handled by the diagnostic panel is also not included in normal decision requests. You can check each item's source in the [diagnostic panel](../guides/debugging).

Your own API accepts at most 50 `visits`, 30 `actions`, 20 `facts` and 100 `delivery` campaigns. `page.path` is accepted up to 512 characters. The SDK doesn't truncate the path to that length, and if it is exceeded, API validation rejects it. For other limits, see [settings and limits](../reference/configuration).

The API validates the permitted and excluded paths, the valid viewing time and count, and the registered event names and state names. It doesn't pass everything the SDK sent unconditionally to Jev.

## What is sent to Jev

Your own API builds the following `state` from the current and entry pages and the valid past views, and sends it to Jev together with the configured `model` and the campaign's `questions`.

| Key                                                     | Contents and conversion                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `state.last_qualified_page`                             | The last `page` among the valid views. Name, description, type, themes and so on keep the keys above                         |
| `state.browsing_history_oldest_first[].page`            | The page information of each page that met the minimum viewing time and the permitted path conditions, in oldest-first order |
| `state.browsing_history_oldest_first[].visible_seconds` | The value converted to seconds with `Math.round(visibleMs / 1000)`                                                           |
| `state.actions`                                         | `actions` narrowed to the action names allowed by the API                                                                    |
| `state.facts`                                           | `facts` narrowed to the state names allowed by the API                                                                       |
| `questions`                                             | `{type: "noul", instructions: "judgment question"}` for keys such as `c0q0`                                                  |

`state.current_page` is the current page used to decide the initial display. `state.entry_page` is included only when a saved entry page exists. Both are kept distinct from evidence of "already viewed". If there are no past valid views, `last_qualified_page` is omitted and the history is an empty array.

If the minimum viewing time is 8,000 milliseconds, a past page of 3,000 milliseconds is not added to the new SDK's history. A view of 12,000 milliseconds becomes `visible_seconds: 12`. Reaching the minimum viewing time isn't sent to the server and is used in the next page's initial decision. If you set a campaign's required history count to 0, it can be judged on the current and entry pages even without past history.

`siteId`, `delivery` and `updated` are not included in the `state` used for Jev's judgment. Which views are used as evidence is tuned by the API-side algorithm. When conditions are insufficient, there is no target campaign, the key isn't set or a cost limit applies, it holds without asking Jev.

Even Preview's fixed judgment and forced previews before delivery don't send to the real Jev.

Confirmed conditions, AND/OR and the final display are handled in code. Questions are not allowed to refer to each other's answers.

## What is not sent as it is

Form input, the full text of pages and whole JSON-LD are not sent, and there is no mechanism that automatically takes names or email addresses from forms. GET parameters of URLs are sent by default, so check the values they contain with the exclusion settings. Basic metadata may also contain personal information, so check the information and scope on your real site.

## Server storage

There is no visitor ID, visitor session or behavior-history database. Administrators' users, passkey public keys, admin sessions, site memberships and campaigns are stored in a separate admin database.

Site-only Jev keys are encrypted and stored in a dedicated table of the admin database. Operational records of real Jev calls are also kept: call time, result category, model name, latency and key type. They don't include URLs, visitor information, what was sent or answers. See [the definition and retention of records](../guides/jev).

This doesn't mean there is nothing in the sending to Jev, in CDN or proxy logs, or in Cloudflare Access authentication logs. The operator also checks external services' retention terms, contracts and settings.

Handle the information in the diagnostic panel with care, and also read [secrets and operations](../operations/security).

The legacy mode's fetching order corresponds to [extractPage in the old SDK](https://github.com/manji6/jev-personalization/blob/a51af0efb9b73cf6b5a117021403206099d5c9a3/src/sdk.js). The format your own API currently accepts corresponds to the [schema](https://github.com/manji6/jev-personalization/blob/main/src/schema.js), and the conversion for Jev corresponds to [prepare in the engine](https://github.com/manji6/jev-personalization/blob/main/src/engine.js).
