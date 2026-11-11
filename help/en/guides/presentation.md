# Display types and custom JavaScript

## The three standard types

| Type             | Use                                                         |
| ---------------- | ----------------------------------------------------------- |
| Modal            | Shows a consolidated message in the center                  |
| Floating banner  | Shows a message unobtrusively from the bottom right or left |
| Notification bar | Shows a short notice at the top or bottom                   |

The display title and body are treated as plain text. This is not a feature for pasting arbitrary HTML into a standard type. The basic design is shared in [site settings](./sites).

## Links and images

Link destinations and images are HTTPS URLs. If you set a link destination, also enter the button text.

An image-only display needs the image URL and alt text that describes the image. If an offer that shows only an image can't load the image, it is not counted as a successful display. There is no image upload feature.

## Preview inside the admin console

You can check the look in a small frame before saving. It doesn't reproduce the actual screen width, your site's CSP or the surrounding elements, so also use the [real-page preview](./testing) before delivering.

## Custom JavaScript

Available once a site admin allows it in the site settings. Registering, changing and checking are limited to admins and superusers.

```js
export function render(context) {
  const element = context.mount.ownerDocument.createElement("div");
  element.textContent = context.variables.message || context.content.title;
  context.mount.append(element);
  context.reportShown();
  return () => element.remove();
}
```

An example of string input (the text shown is Japanese: "A recommendation for you").

```json
{
  "message": "あなたにおすすめのご案内です"
}
```

| context       | Contents                                           |
| ------------- | -------------------------------------------------- |
| content       | The saved title, body, link and so on              |
| variables     | Strings set in the admin console                   |
| mount         | The ShadowRoot to render into                      |
| signal        | An AbortSignal that is aborted when the offer ends |
| close()       | Closes the offer                                   |
| reportShown() | Reports that it was actually displayed             |
| mode          | `delivery` normally, `preview` for a check display |

Write a single `export function render(context)`. If cleanup is needed, return a function. Call `reportShown()` only when it was actually rendered.

Authors must make sure custom measurement or update code does not run when `context.mode === 'preview'`. The SDK doesn't increase the normal display count, but it doesn't undo every side effect of custom code.

::: warning Code runs with the same privileges as your site
It is not a sandbox. Register only code you trust, and don't embed API keys, tokens or personal information. The code and variables are public information delivered to the browser. Custom code is not executed inside the admin console.
:::

In your site's CSP, allow the SDK's origin, connections to the API, images and any custom modules you need. Don't loosen the whole site's CSP unconditionally. Allow only the origins you need.
