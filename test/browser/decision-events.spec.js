import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
let requests, respond, config, configRequests, requestHeaders;
const campaign = {
  id: "guide",
  content: { title: "導入ガイド", body: "案内" },
  presentation: { type: "floating" },
};
test.beforeEach(async ({ page }) => {
  requests = [];
  requestHeaders = [];
  configRequests = 0;
  respond = async () => ({ decision: "hold" });
  config = {
    metadataEnabled: true,
    minVisibleMs: 1000,
    allowedPathPrefixes: ["/guides/"],
    excludedPathPrefixes: ["/guides/private"],
    actionNames: ["download"],
    factNames: ["registered"],
    excludedQueryKeys: [],
  };
  await page.clock.install();
  const sdk = await readFile("dist/sdk.js", "utf8");
  await page.route("https://api.example.com/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/sdk.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: sdk,
      });
    if (u.pathname === "/v1/sites/demo") {
      configRequests++;
      return route.fulfill({ json: config });
    }
    if (u.pathname === "/v1/decision") {
      const body = route.request().postDataJSON();
      requests.push(body);
      requestHeaders.push(route.request().headers());
      const response = await respond(body, requests.length);
      return route.fulfill({
        status: response.httpStatus ?? 200,
        json: response,
      });
    }
    throw Error("Unexpected URL " + u.pathname);
  });
  await page.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><title>Guide</title><script src="https://api.example.com/sdk.js" data-site="demo" defer></script>',
    }),
  );
  await page.goto("https://www.example.com/guides/a");
});
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "wait" }));
async function start(page) {
  await page.evaluate(() => window.JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
}
async function local(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("jev:v1:demo")));
}
async function visibility(page, value) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}
test("one initial decision, qualification only updates storage, and manual/idle calls never repeat", async ({
  page,
}) => {
  await start(page);
  expect(requests[0].protocolVersion).toBe(2);
  expect(requests[0].currentPage.path).toBe("/guides/a");
  expect(requests[0].visits).toEqual([]);
  expect((await local(page)).visits).toHaveLength(0);
  await page.clock.runFor(1200);
  expect((await local(page)).visits).toHaveLength(1);
  expect((await local(page)).visits[0].visibleMs).toBeGreaterThanOrEqual(1000);
  expect(requests).toHaveLength(1);
  await page.clock.fastForward(600000);
  await page.evaluate(() => window.JevPersonalization.decide());
  expect(requests).toHaveLength(1);
});
test("the initial decision carries qualified previous history separately from the current page", async ({
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
  expect(requests[0].visits).toHaveLength(1);
  expect(requests[0].visits[0].page.name).toBe("Previous");
  expect(requests[0].currentPage.name).toBe("Guide");
});
test("actions and facts update locally and are included only in the next page initial request", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    JevPersonalization.track("download", true);
    JevPersonalization.track("unknown");
    JevPersonalization.setFact("registered", false);
    JevPersonalization.setFact("unknown", true);
  });
  await page.clock.runFor(1200);
  expect(requests).toHaveLength(1);
  expect((await local(page)).actions).toEqual([
    { name: "download", value: true },
  ]);
  expect((await local(page)).facts).toEqual({ registered: false });
  await page.evaluate(() => history.pushState({}, "", "/guides/b"));
  await page.clock.runFor(250);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].actions).toEqual([{ name: "download", value: true }]);
  expect(requests[1].facts).toEqual({ registered: false });
  expect(requests[1].visits).toHaveLength(1);
  expect(requests[1].currentPage.path).toBe("/guides/b");
  expect(configRequests).toBe(2);
});
test("hidden initial pages defer their only decision and do not qualify hidden time", async ({
  page,
}) => {
  await visibility(page, "hidden");
  await page.evaluate(() => JevPersonalization.consent(true));
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(0);
  expect((await local(page)).visits).toHaveLength(0);
  await visibility(page, "visible");
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.runFor(1200);
  expect((await local(page)).visits).toHaveLength(1);
  expect(requests).toHaveLength(1);
});
test("state changes during an inflight result discard the offer without a second request", async ({
  page,
}) => {
  let release;
  const wait = new Promise((r) => (release = r));
  respond = async () => {
    await wait;
    return { decision: "show", campaign };
  };
  await page.evaluate(() => JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() => JevPersonalization.setFact("registered", true));
  const response = page.waitForResponse("**/v1/decision?siteId=demo");
  release();
  await response;
  await page.clock.runFor(1500);
  await expect(page.locator("[data-jev-offer]")).toHaveCount(0);
  expect(requests).toHaveLength(1);
});
test("SPA path navigation creates one decision, query/meta updates are local, and excluded routes do not request", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    history.pushState({}, "", "/guides/b");
    document.title = "Next guide";
  });
  await page.clock.runFor(250);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].currentPage.name).toBe("Next guide");
  await page.evaluate(() => {
    history.replaceState({}, "", "/guides/b?cid=runner#section");
    document.title = "Updated guide";
  });
  await page.clock.runFor(1500);
  expect(requests).toHaveLength(2);
  expect((await local(page)).currentVisit.page.name).toBe("Updated guide");
  expect((await local(page)).currentVisit.page.url).toBe(
    "https://www.example.com/guides/b?cid=runner",
  );
  await page.evaluate(() => history.pushState({}, "", "/guides/private"));
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(2);
});
test("withdrawal removes pending local data and never schedules another request", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    JevPersonalization.track("download");
    JevPersonalization.consent(false);
  });
  await page.clock.fastForward(60000);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
test("failed requests are not retried on time, events or manual decide, but the next page can request once", async ({
  page,
}) => {
  respond = async () => ({ httpStatus: 503, decision: "hold" });
  await start(page);
  await page.clock.fastForward(600000);
  await page.evaluate(() => {
    JevPersonalization.decide();
    JevPersonalization.track("download");
    JevPersonalization.setFact("registered", true);
  });
  await page.clock.runFor(200);
  expect(requests).toHaveLength(1);
  await page.evaluate(() => history.pushState({}, "", "/guides/b"));
  await page.clock.runFor(250);
  await expect.poll(() => requests.length).toBe(2);
});
test("an old inflight response cannot display after leaving and returning to the same path", async ({
  page,
}) => {
  let release;
  const wait = new Promise((r) => (release = r));
  respond = async (_, i) => {
    if (i === 1) {
      await wait;
      return { decision: "show", campaign };
    }
    return { decision: "hold" };
  };
  await page.evaluate(() => JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() => {
    history.pushState({}, "", "/guides/b");
    history.pushState({}, "", "/guides/a");
  });
  await page.clock.runFor(250);
  release();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].currentPage.path).toBe("/guides/a");
  await expect(page.locator("[data-jev-offer]")).toHaveCount(0);
});
test("pagehide pauses time; pageshow resumes local qualification without another decision", async ({
  page,
}) => {
  await start(page);
  await page.clock.runFor(300);
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  await page.clock.fastForward(60000);
  expect((await local(page)).visits).toHaveLength(0);
  await page.evaluate(() => dispatchEvent(new Event("pageshow")));
  await page.clock.runFor(800);
  expect((await local(page)).visits).toHaveLength(1);
  expect(requests).toHaveLength(1);
});
test("a response received while hidden displays on return without a second request", async ({
  page,
}) => {
  let release;
  const wait = new Promise((r) => (release = r));
  respond = async () => {
    await wait;
    return { decision: "show", campaign };
  };
  await page.evaluate(() => JevPersonalization.consent(true));
  await expect.poll(() => requests.length).toBe(1);
  await visibility(page, "hidden");
  release();
  await page.clock.runFor(200);
  await expect(page.locator("[data-jev-offer]")).toHaveCount(0);
  await visibility(page, "visible");
  await page.clock.runFor(200);
  await expect(page.getByRole("heading", { name: "導入ガイド" })).toBeVisible();
  expect(requests).toHaveLength(1);
});
test("URL exclusions apply before storage and sending while entry tracking survives navigation", async ({
  page,
}) => {
  config.excludedQueryKeys = ["email", "token"];
  await page.evaluate(() =>
    history.replaceState(
      {},
      "",
      "/guides/a?cid=mail_runner&email=PRIVATE&token=SECRET&token=OTHER#fragment",
    ),
  );
  await start(page);
  expect(requests[0].currentPage.url).toBe(
    "https://www.example.com/guides/a?cid=mail_runner",
  );
  expect(requests[0].entryPage.url).toBe(requests[0].currentPage.url);
  expect(JSON.stringify(await local(page))).not.toMatch(
    /PRIVATE|SECRET|OTHER|fragment/,
  );
  expect(requestHeaders[0].referer).toBeUndefined();
  await page.clock.runFor(1200);
  await page.evaluate(() => history.pushState({}, "", "/guides/b"));
  await page.clock.runFor(250);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].entryPage.url).toContain("cid=mail_runner");
  expect(requests[1].currentPage.url).toBe("https://www.example.com/guides/b");
  expect(requests[1].visits[0].page.url).toContain("cid=mail_runner");
  expect(JSON.stringify(requests)).not.toMatch(/PRIVATE|SECRET|OTHER|fragment/);
});

test("query changes invalidate an inflight offer without sending a second decision", async ({
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
  await page.evaluate(() => {
    void window.JevPersonalization.consent(true);
  });
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() =>
    history.replaceState({}, "", "/guides/a?cid=changed"),
  );
  const response = page.waitForResponse("**/v1/decision?siteId=demo");
  release();
  await response;
  await page.clock.runFor(1500);
  expect(requests).toHaveLength(1);
  await expect(page.locator("[data-jev-offer]")).toHaveCount(0);
  expect((await local(page)).currentVisit.page.url).toContain("cid=changed");
});
