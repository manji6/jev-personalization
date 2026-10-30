import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

let requests, respond;
const config = {
  metadataEnabled: true,
  minVisibleMs: 1000,
  allowedPathPrefixes: ["/guides/"],
  excludedPathPrefixes: ["/guides/private"],
  actionNames: ["download"],
  factNames: ["registered"],
};
const campaign = {
  id: "guide",
  content: { title: "導入ガイド", body: "案内" },
  presentation: { type: "floating" },
};
test.beforeEach(async ({ page }) => {
  requests = [];
  respond = async () => ({ decision: "hold" });
  await page.clock.install();
  const sdk = await readFile("dist/sdk.js", "utf8");
  await page.route("https://api.example.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/sdk.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: sdk,
      });
    if (url.pathname === "/v1/sites/demo")
      return route.fulfill({ json: config });
    if (url.pathname === "/v1/decision") {
      const body = route.request().postDataJSON();
      requests.push(body);
      const response = await respond(body, requests.length);
      return route.fulfill({
        status: response.httpStatus ?? 200,
        json: response,
      });
    }
    throw new Error(`Unexpected URL: ${url.pathname}`);
  });
  await page.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Guide</title><script src="https://api.example.com/sdk.js" data-site="demo" defer></script>',
    }),
  );
  await page.goto("https://www.example.com/guides/a");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
async function start(page) {
  await page.evaluate(() => window.JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  // Wait until the response has been handled, without advancing the SDK clock.
  await page.evaluate(
    () => new Promise((r) => window.requestAnimationFrame(r)),
  );
}
async function visibility(page, state) {
  await page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("initial request is immediate; qualification triggers once; idle time and manual calls do not poll", async ({
  page,
}) => {
  expect(requests).toHaveLength(0);
  await start(page);
  expect(requests[0].visits[0].visibleMs).toBeLessThan(1000);
  await page.clock.runFor(900);
  expect(requests).toHaveLength(1);
  await page.clock.runFor(300);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].visits[0].visibleMs).toBeGreaterThanOrEqual(1000);
  await page.clock.fastForward(600000);
  await page.evaluate(() => window.JevPersonalization.decide());
  expect(requests).toHaveLength(2);
});

test("qualified browser history can display an offer on the initial request", async ({
  page,
}) => {
  respond = async () => ({ decision: "show", campaign });
  await page.evaluate(() =>
    sessionStorage.setItem(
      "jev:v1:demo",
      JSON.stringify({
        updated: Date.now(),
        visits: [
          {
            page: { path: "/guides/previous", name: "Previous" },
            visibleMs: 5000,
          },
        ],
        actions: [],
        facts: {},
        delivery: {},
      }),
    ),
  );
  await start(page);
  await expect(page.getByRole("heading", { name: "導入ガイド" })).toBeVisible();
  expect(requests[0].visits).toHaveLength(2);
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(1);
});

test("allowed action and changed fact events are batched; unchanged and invalid facts do not request", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const api = window.JevPersonalization;
    api.track("download", true);
    api.setFact("registered", false);
    api.setFact("registered", false);
    api.track("unknown");
    api.setFact("private", true);
  });
  await page.clock.runFor(150);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].actions).toEqual([{ name: "download", value: true }]);
  expect(requests[1].facts).toEqual({ registered: false });
  await page.evaluate(() =>
    window.JevPersonalization.setFact("registered", false),
  );
  await page.clock.runFor(150);
  expect(requests).toHaveLength(2);
});

test("hidden time does not qualify a visit; tab visibility alone does not repeat a decision", async ({
  page,
}) => {
  await start(page);
  await page.clock.runFor(300);
  await visibility(page, "hidden");
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(1);
  await visibility(page, "visible");
  await page.clock.runFor(200);
  expect(requests).toHaveLength(1);
  await page.clock.runFor(700);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].visits[0].visibleMs).toBeLessThan(2000);
});

test("events during an inflight request queue the latest state and discard the stale offer", async ({
  page,
}) => {
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  respond = async (_, index) => {
    if (index === 1) {
      await wait;
      return { decision: "show", campaign };
    }
    return { decision: "hold" };
  };
  await page.evaluate(() => window.JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() =>
    window.JevPersonalization.setFact("registered", true),
  );
  await page.clock.runFor(150);
  expect(requests).toHaveLength(1);
  const response = page.waitForResponse("**/v1/decision?siteId=demo");
  release();
  await response;
  // Allow fetch continuations to schedule the queued decision.
  await expect(page.locator("aside")).toHaveCount(0);
  await page.clock.runFor(200);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].facts).toEqual({ registered: true });
  await expect(page.locator("aside")).toHaveCount(0);
});

test("SPA entry triggers immediately after metadata settling; excluded pages and irrelevant metadata do not request", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    history.pushState({}, "", "/guides/b");
    document.title = "Next guide";
  });
  await page.clock.runFor(250);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].visits.at(-1).page.name).toBe("Next guide");
  await page.evaluate(() => {
    const meta = document.createElement("meta");
    meta.name = "irrelevant";
    meta.content = "unrelated";
    document.head.append(meta);
  });
  await page.clock.runFor(150);
  expect(requests).toHaveLength(2);
  await page.evaluate(() => {
    document.title = "Updated guide";
  });
  await page.clock.runFor(150);
  await expect.poll(() => requests.length).toBe(3);
  await page.evaluate(() => history.pushState({}, "", "/guides/private"));
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(3);
});

test("consent withdrawal cancels pending qualification and event requests", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    window.JevPersonalization.track("download");
    window.JevPersonalization.consent(false);
  });
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("failed requests do not retry on a timer; a new event can request again", async ({
  page,
}) => {
  respond = async () => ({ httpStatus: 503, decision: "hold" });
  await start(page);
  await page.clock.runFor(1200);
  await expect.poll(() => requests.length).toBe(2);
  await page.clock.fastForward(600000);
  await page.evaluate(() => window.JevPersonalization.decide());
  expect(requests).toHaveLength(2);
  await page.evaluate(() => window.JevPersonalization.track("download"));
  await page.clock.runFor(150);
  await expect.poll(() => requests.length).toBe(3);
});

test("an inflight offer is stale even after navigating away and back to the same URL", async ({
  page,
}) => {
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  respond = async (_, index) => {
    if (index === 1) {
      await wait;
      return { decision: "show", campaign };
    }
    return { decision: "hold" };
  };
  await page.evaluate(() => window.JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() => {
    history.pushState({}, "", "/guides/b");
    history.pushState({}, "", "/guides/a");
  });
  await page.clock.runFor(250);
  const response = page.waitForResponse("**/v1/decision?siteId=demo");
  release();
  await response;
  await page.clock.runFor(200);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].visits).toHaveLength(2);
  await expect(page.locator("aside")).toHaveCount(0);
});

test("pagehide pauses collection and pending decisions until pageshow", async ({
  page,
}) => {
  await start(page);
  await page.clock.runFor(300);
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(1);
  await page.evaluate(() => dispatchEvent(new Event("pageshow")));
  await page.clock.runFor(200);
  expect(requests).toHaveLength(1);
  await page.clock.runFor(700);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].visits[0].visibleMs).toBeLessThan(2000);
});

test("an offer received while hidden waits for visibility without another request", async ({
  page,
}) => {
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  respond = async () => {
    await wait;
    return { decision: "show", campaign };
  };
  await page.evaluate(() => window.JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  await visibility(page, "hidden");
  const response = page.waitForResponse("**/v1/decision?siteId=demo");
  release();
  await response;
  await page.clock.runFor(200);
  await expect(page.locator("aside")).toHaveCount(0);
  await visibility(page, "visible");
  await page.clock.runFor(200);
  await expect(page.getByRole("heading", { name: "導入ガイド" })).toBeVisible();
  expect(requests).toHaveLength(1);
});
