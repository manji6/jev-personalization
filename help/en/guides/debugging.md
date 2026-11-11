# Read the diagnostic panel

Find out "why it was displayed" or "why it isn't displayed" in the browser you are actually using. You need edit permission for the site.

## How to open it

In "Verification (「動作確認」)" in the admin console, enter the target URL and start diagnostics on the real site. Keep both the site with the SDK and the admin console open.

A temporary panel appears on the site. No browser extension is needed. The authorization is limited to the site and origin, and is valid for 15 minutes. No admin token or passkey information is passed to the site.

## What you can see

| Tab                  | Contents                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Current state        | Consent, measurement, display time, the current page and so on                                                     |
| Browsing and actions | Pages observed in this browser, where information was taken from, additional events and states                     |
| Judgment history     | Decision API requests and responses, state/questions for Jev, scores, confirmed conditions and display constraints |

History is not saved on the server for diagnostics. The panel observes normal API requests, and opening it doesn't trigger an extra Jev request. Diagnostics don't bypass consent either.

## How to read why it isn't displayed

- **Metadata sending is not approved**: check whether you enabled sending in the site settings.
- **Not enough valid views**: check the display time and the count. Time in a background tab is not counted as display time.
- **Outside the target pages**: check the collected range and the campaign's display targets separately.
- **Already displayed or closed**: check the limit and state in this browser.
- **Confirmed state is unknown**: if you specified an excluded fact, pass false/true explicitly.
- **The score is too low**: check the question and the threshold. Don't read the score as a purchase rate.
- **Model error or cost limit**: the operator checks the key, model and limit.

## Preview test values

In the stub environment, it is labeled "Judged with a fixed test value" and "Not sent to Jev". The 0.95 here is not output from the real model. Don't treat it as a measurement of usage or speed.

## When you share it

Requests and screens contain page information and behavior information. Before sharing a screenshot or JSON, check that it contains no personal information, confidential information or credentials. Don't paste real browsing history as it is into ordinary Issues.

Close diagnostics with the end button. Authorization is also lost when a user is disabled or site permission is revoked. Simply signing out does not individually clear an already issued diagnostic authorization.

## Telling the initial decision from local updates

The current page, the entry page and past valid views are shown separately. The initial decision for a page happens only once. Reaching the minimum viewing time is recorded as "Saved to valid views (no communication)", and the integration of events and states is also recorded as a local update. In the judgment history, check the JSON and the response at the time of the request.

If the diagnostic connection wasn't ready in time for the initial decision, the details of that request are not recovered afterward. Move to the next page and check its initial decision. No extra Jev request is made to open the panel.

## The browsing and actions timeline

The upper part of "Browsing and actions" shows the history of actions from entry to now. It starts oldest first, and you can switch to newest first. A page card shows its name, path and display time, and "Fetched page information" opens the details. The current page is highlighted in green to distinguish it from past valid views.

Allowed actions and state changes integrated during diagnostics appear between page views in time order. Revisiting the same page counts as a separate view. The lower "Other measurement information" section gathers where the current page's information came from, the actions and states being held, and each campaign's display count and closed state.

After a reload, the saved entry page and past valid views are shown. Times that weren't saved are shown as "No time recorded", and pages in between that were shorter than the minimum viewing time and the times of past actions are not guessed or filled in. Times and short views from during diagnostics are kept only inside the existing diagnostic buffer (up to 60 items and 1 MB in total), and are erased on consent withdrawal, ending, expiry and a normal reload. No diagnostic times or view IDs are added to storage or API requests.
