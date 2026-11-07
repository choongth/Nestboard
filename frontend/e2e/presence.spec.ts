// Who else has the diagram open, and what they are doing: avatars, their
// level, selections, pointers and drags (see src/files/presence.ts). Also
// what others change about the diagram itself: access, its name, deleting it.

import type { Page } from "@playwright/test";
import type { DiagramRecord } from "../src/api/diagrams";
import { E2E_ACCOUNT } from "./account";
import {
  BASE,
  center,
  check,
  DIAGRAMS_API,
  drag,
  enter,
  expect,
  GRANTS_API,
  nodeNamed,
  someoneElse,
  synced,
  test,
} from "./helpers";

const avatar = (page: Page, name: string) =>
  page.getByRole("group", { name: "Also here" }).getByRole("button", { name: new RegExp(`^${name}, `) });

test("who else is here: where they are, what they select, their pointer and their drags", async ({
  page,
  browser,
  request,
}) => {
  const document = {
    schemaVersion: 5,
    root: {
      id: "r",
      title: "Root",
      position: { x: 0, y: 0 },
      edges: [],
      children: [
        {
          id: "shop",
          title: "Shop",
          position: { x: 0, y: 0 },
          edges: [],
          children: [{ id: "cart", title: "Cart", position: { x: 0, y: 0 }, children: [], edges: [] }],
        },
        { id: "web", title: "Web", position: { x: 500, y: 0 }, children: [], edges: [] },
      ],
    },
  };
  const diagram = (await (
    await request.post(DIAGRAMS_API, { data: { name: `E2E presence ${Date.now()}`, document } })
  ).json()) as DiagramRecord;
  const ada = await someoneElse(browser, request, "Ada Lovelace");
  for (const tab of [page, ada.page]) {
    await tab.goto(`${BASE}/editor?diagram=${diagram.id}`);
    await expect(nodeNamed(tab, "Web")).toBeVisible();
  }

  await test.step("each sees the other, and where they are", async () => {
    await expect(avatar(page, "Ada Lovelace")).toHaveAccessibleName("Ada Lovelace, at the top level. Go there");
    await expect(avatar(ada.page, E2E_ACCOUNT.displayName)).toBeVisible();
    check("nobody sees themselves", (await avatar(page, E2E_ACCOUNT.displayName).count()) === 0);
  });

  await test.step("a box they select shows in their colour, with their name", async () => {
    await nodeNamed(ada.page, "Web").click();
    await expect(nodeNamed(page, "Web").locator("[data-watched-by]")).toHaveText("Ada Lovelace");
    await ada.page.keyboard.press("Escape");
    await expect(nodeNamed(page, "Web").locator("[data-watched-by]")).toHaveCount(0);
  });

  await test.step("their pointer moves on my screen", async () => {
    await ada.page.mouse.move(300, 650);
    await expect(page.locator('[data-remote-cursor="Ada Lovelace"]')).toBeVisible();
  });

  await test.step("a box they drag moves on my screen before they let go, and lands", async () => {
    const before = (await nodeNamed(page, "Web").boundingBox())!;
    const from = await center(nodeNamed(ada.page, "Web"));
    await drag(ada.page, from, { x: from.x, y: from.y + 220 }, {
      midway: async () => {
        await expect.poll(async () => (await nodeNamed(page, "Web").boundingBox())!.y).toBeGreaterThan(before.y + 100);
      },
    });
    await synced(ada.page);
    await expect.poll(async () => (await nodeNamed(page, "Web").boundingBox())!.y).toBeGreaterThan(before.y + 100);
  });

  await test.step("their level shows on their avatar, and clicking it goes there", async () => {
    await enter(ada.page, "Shop");
    await expect(avatar(page, "Ada Lovelace")).toHaveAccessibleName("Ada Lovelace, inside Shop. Go there");
    await avatar(page, "Ada Lovelace").click();
    await expect(nodeNamed(page, "Cart")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Shop");
  });

  await test.step("once they close the diagram, they are gone", async () => {
    await ada.close();
    await expect(avatar(page, "Ada Lovelace")).toHaveCount(0);
  });
  expect(ada.errors, "browser console errors in Ada's tab").toEqual([]);
});

test("access, a new name and a deletion made elsewhere show at once", async ({ page, browser, request }) => {
  const document = {
    schemaVersion: 5,
    root: {
      id: "r",
      title: "Root",
      position: { x: 0, y: 0 },
      edges: [],
      children: ["Shop", "Web"].map((title, i) => ({
        id: title.toLowerCase(),
        title,
        position: { x: i * 500, y: 0 },
        children: [],
        edges: [],
      })),
    },
  };
  const name = `E2E access ${Date.now()}`;
  const diagram = (await (await request.post(DIAGRAMS_API, { data: { name, document } })).json()) as DiagramRecord;
  const ada = await someoneElse(browser, request, "Ada Lovelace", "viewer");
  for (const tab of [page, ada.page]) {
    await tab.goto(`${BASE}/editor?diagram=${diagram.id}`);
    await expect(nodeNamed(tab, "Web")).toBeVisible();
  }
  const locked = (title: string) => nodeNamed(ada.page, title).locator("[data-locked]");
  await expect(locked("Shop")).toHaveCount(1);

  await test.step("a grant on a box unlocks it for them at once; who is in charge shows for everyone", async () => {
    const box = (id: string, role: string) =>
      request.put(GRANTS_API, { data: { role, user_id: ada.userId, diagram_id: diagram.id, box_id: id } });
    await box("shop", "editor");
    await expect(locked("Shop")).toHaveCount(0);
    await expect(locked("Web")).toHaveCount(1);
    await box("web", "owner");
    await expect(nodeNamed(page, "Web").locator("[data-in-charge]")).toHaveText("Ada Lovelace");
    await expect(locked("Web")).toHaveCount(0);
  });

  await test.step("a new name shows in every tab", async () => {
    await request.patch(`/api/v1/diagrams/${diagram.id}`, { data: { name: `${name} v2` } });
    await expect(ada.page.getByRole("button", { name: /^File:/ })).toHaveAccessibleName(`File: ${name} v2`);
    await expect(ada.page).toHaveTitle(`${name} v2 — Nestboard`);
  });

  await test.step("a deletion closes it, saying why", async () => {
    await request.delete(`/api/v1/diagrams/${diagram.id}`);
    const dialog = ada.page.getByRole("alertdialog");
    await expect(dialog).toContainText("This diagram is no longer available");
    await expect(dialog).toContainText("The diagram was deleted.");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(ada.page.locator(".react-flow__node")).toHaveCount(0);
    await expect(ada.page.getByRole("button", { name: /^File:/ })).toHaveAccessibleName("File: Untitled");
  });

  await ada.close();
  expect(ada.errors, "browser console errors in Ada's tab").toEqual([]);
});
