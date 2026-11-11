# Preview and verification

## Three ways to check

| Method                                 | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| The display image in the admin console | Check the look while you type                     |
| Preview in the campaign list           | Force a one-time display on a real page           |
| The diagnostic panel for verification  | Observe normal measurement, sending and decisions |

The Cloudflare Preview used to update the system is [a feature for checking a separate environment](../getting-started/preview-production).

## Show a check display on a real page

1. Save the content as a draft.
2. Press "Preview (「プレビュー」)" in the campaign list.
3. Enter the page URL you want to check.
4. Press "Open page and check (「ページを開いて確認」)", and keep the admin console open too.

A saved draft takes priority, and without one the saved delivery content is used. Unsaved edits are not included. You can also check campaigns that are stopped or not yet in normal delivery.

## URL conditions

The URL must match the site's registered origin, the collected or excluded paths, and the campaign's display targets. For example, you can't check a campaign with an exact match of `/ja/` on `/ja/products/a`.

The target page needs the latest SDK. If a CMP prevents the SDK itself from loading, you can't start it. It is not a mechanism that rewrites your site's HTML or injects the tag automatically.

## The one-time mechanism

A check ticket is valid for 5 minutes and works once. It is handed from the admin console to the tab you just opened and shows the specified campaign. The ticket itself is not stored in the page URL or in Web Storage.

During a check, normal measurement and automatic decisions are paused. It doesn't call Jev, and it doesn't update the normal history, display count or closed state. The page also indicates that it is a check display.

It ends when you close it or navigate away. A copy of the same URL or a reload doesn't carry the forced display over. If, after a reload, the conditions are met and normal delivery happens, that is separate behavior.

## If it wasn't displayed

Check for an expired ticket, changed settings, changed permissions, CSP, images, pop-up restrictions, COOP and so on. If rendering fails after the ticket is redeemed, it is still used up, so start a new preview.

Checking custom JavaScript is limited to admins and above. Authors should suppress custom measurement or updates in preview mode.

## Final check of delivery

Even if a forced display succeeds, it doesn't verify that the audience judgment is correct. Normal delivery goes through consent, valid views, confirmed conditions, Jev's score, the threshold and display constraints. Also check the normal flow in the [diagnostic panel](./debugging).

## Check how page information is fetched

If you want to check which page name and description are fetched, not how the offer looks, use [Site settings → Page information fetching](./sites#fetching-page-information-and-checking-on-a-real-page). Enter a URL and check a draft of the settings, unsaved, with the SDK on the real page. This check doesn't perform Jev judgment or offer display.

## Try only how conditions combine

With "Test these settings (「この設定を試す」)" in campaign editing, you can check the AND/OR result from URL conditions and provisional Jev scores. It doesn't call the Jev API. Use this test to confirm the conditions are connected correctly, the diagnostic panel for the actual inference in normal delivery, and the real-page preview for the look. For details, see [connect conditions](./campaigns#connect-conditions).
