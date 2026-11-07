import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { SCHEMA_VERSION } from "../src/model/types";
import { boxTypes } from "../src/registry/boxTypes";
import {
  check,
  nodeNamed,
  openApp,
  openFileViaChooser,
  readDiagram,
  saveViaDownload,
  test,
  useFileFallback,
} from "./helpers";

// The examples folder sits at the repository root, next to frontend/.
const GALLERY = fileURLToPath(new URL("../../examples/box-types-gallery.json", import.meta.url));

/** Hex → the rgb() form browsers report for computed colours. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

const box = (page: Page, title: string) => nodeNamed(page, title).locator("[data-box-type]");
const label = (b: Locator) => b.locator("[data-box-label]");
const iconClass = (b: Locator) => b.locator("[data-box-icon] svg").getAttribute("class");

test("boxes show their type: label on the border, icon tile, centred title", async ({ page }) => {
  await useFileFallback(page);
  await openApp(page);

  await test.step("a new box is generic: no label, no type icon", async () => {
    await page.mouse.click(500, 400, { button: "right" });
    await page.getByRole("menuitem", { name: "New box" }).click();
    await page.keyboard.press("Enter");
    const b = page.locator("[data-box-type]").first();
    check("new box is generic", (await b.getAttribute("data-box-type")) === "generic");
    check("generic boxes have no label", (await label(b).count()) === 0);
    check("generic boxes show no type icon", (await b.locator("[data-box-icon]").count()) === 0);
    check("no technology, no logo", (await b.locator("[data-tech-logo]").count()) === 0);
  });

  await test.step("colours are neutral, not blue: selection, connection points, menu, fields", async () => {
    const b = page.locator("[data-box-type]").first();
    check("selected box has a white border", (await b.evaluate((el) => getComputedStyle(el).borderColor)) === rgb("#e7e9ee"));
    await b.hover();
    const dot = await b.locator(".react-flow__handle-top").evaluate((el) => getComputedStyle(el).borderColor);
    check("connection points are white", dot === rgb("#e7e9ee"), dot);
    await page.getByLabel("Name").focus();
    await page.waitForTimeout(250); // the border colour animates
    const field = await page.getByLabel("Name").evaluate((el) => getComputedStyle(el).borderColor);
    check("a focused field has a grey border", field === rgb("#9aa2b1"), field);
    await page.mouse.click(30, 820);
    await page.mouse.click(900, 600, { button: "right" });
    const item = page.getByRole("menuitem", { name: "New box" });
    await item.hover();
    const bg = await item.evaluate((el) => getComputedStyle(el).backgroundColor);
    check("menu highlight is grey", bg === rgb("#2c313b"), bg);
    await page.keyboard.press("Escape");
  });

  await openFileViaChooser(page, GALLERY);
  const galleryJson = JSON.parse(readFileSync(GALLERY, "utf8"));
  const titleOf = (typeId: string | undefined) =>
    galleryJson.root.children.find((c: { typeId?: string }) => c.typeId === typeId).title as string;

  await test.step("every built-in type draws its own label, icon and category colour", async () => {
    for (const type of boxTypes.types) {
      if (type.id === "generic") continue; // covered above
      const b = box(page, titleOf(type.id));
      const color = boxTypes.category(type.categoryId).color;
      check(`${type.id}: recognised`, (await b.getAttribute("data-box-type")) === type.id);
      check(`${type.id}: label`, (await label(b).innerText()) === type.label.toUpperCase(), await label(b).innerText());
      check(
        `${type.id}: label in category colour`,
        (await label(b).locator("[data-box-label-text]").evaluate((el) => getComputedStyle(el).color)) === rgb(color),
      );
      check(`${type.id}: icon sits in the label`, (await label(b).locator("[data-box-icon]").count()) === 1);
      check(`${type.id}: icon`, (await iconClass(b))!.includes(`lucide-${type.icon}`), String(await iconClass(b)));
      check(
        `${type.id}: icon in category colour`,
        (await b.locator("[data-box-icon]").evaluate((el) => getComputedStyle(el).color)) === rgb(color),
      );
    }
  });

  await test.step("layout: label on the top border, title centred, no technology or description", async () => {
    const lb = box(page, "Edge LB");
    const outer = (await lb.boundingBox())!;
    const tag = (await label(lb).boundingBox())!;
    check("label sits on the top border", Math.abs(tag.y + tag.height / 2 - outer.y) <= 1.5, `${tag.y + tag.height / 2} vs ${outer.y}`);
    check("label is at the left", tag.x - outer.x < 20);
    const title = (await lb.locator("[data-box-title]").boundingBox())!;
    check("title is centred across", Math.abs(title.x + title.width / 2 - (outer.x + outer.width / 2)) <= 2);
    check("title is near the middle vertically", Math.abs(title.y + title.height / 2 - (outer.y + outer.height / 2)) <= 12);
    const fontSize = await lb.locator("[data-box-title]").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check("title is larger than before (17px)", fontSize === 17, String(fontSize));
    check("technology name is not written on the box", !(await lb.innerText()).includes("Nginx"));
    const logo = lb.locator("[data-tech-logo]");
    check("the technology logo is shown", (await logo.getAttribute("data-tech-logo")) === "logo" && (await logo.locator("svg").getAttribute("aria-label")) === "NGINX");
    const logoBox = (await logo.boundingBox())!;
    check("logo sits top-left where the icon tile was", logoBox.x - outer.x < 20 && logoBox.y - outer.y < 24);
    const typeIcon = (await label(lb).locator("[data-box-icon] svg").boundingBox())!;
    check("logo is a little bigger than the type icon", logoBox.width > typeIcon.width, `${logoBox.width} vs ${typeIcon.width}`);
    check("Orders DB shows PostgreSQL", (await box(page, "Orders DB").locator("[data-tech-logo] svg").getAttribute("aria-label")) === "PostgreSQL");
    check("boxes without a technology show no logo", (await box(page, "Customer").locator("[data-tech-logo]").count()) === 0);
    await page.evaluate(() => {
      const store = window.__nestboard!.diagramStore.getState();
      const node = Object.values(store.diagram.nodes).find((n) => n.title === "Throttle")!;
      store.updateBox(node.id, { technology: "HAProxy" });
    });
    const mono = box(page, "Throttle").locator("[data-tech-logo]");
    check("a technology without a logo shows a monogram", (await mono.getAttribute("data-tech-logo")) === "monogram" && (await mono.innerText()) === "HA");
    await page.evaluate(() => {
      const store = window.__nestboard!.diagramStore.getState();
      const node = Object.values(store.diagram.nodes).find((n) => n.title === "Throttle")!;
      store.updateBox(node.id, { technology: "AWS WAF" });
    });
    // Full-colour logos are loaded the first time one is drawn.
    const color = box(page, "Throttle").locator('[data-tech-logo="color"] svg[aria-label="AWS WAF"]');
    await color.waitFor();
    check("a brand simple-icons lacks shows its full-colour logo", (await color.locator("path").count()) > 0);
    const shown = (await color.boundingBox())!;
    check("…at the size of the others", Math.abs(shown.width - logoBox.width) <= 1, `${shown.width} vs ${logoBox.width}`);
  });

  await test.step("group and note have their own look", async () => {
    const group = box(page, "Checkout");
    check("group has a dashed border", (await group.evaluate((el) => getComputedStyle(el).borderStyle)) === "dashed");
    const groupBg = await group.evaluate((el) => getComputedStyle(el).backgroundColor);
    check("group background is faint (see-through)", /rgba\(.*, 0\.3\d*\)|oklab\(.* \/ 0\.3/.test(groupBg), groupBg);
    check("group keeps its nested badge", (await group.locator("[title='2 nested boxes']").count()) === 1);
    const note = box(page, "Payments must be idempotent");
    check("note looks like a sticky note", (await note.getAttribute("class"))!.includes("nb-note"));
  });

  await test.step("an unknown type is drawn as generic but shows its stored id", async () => {
    const odd = box(page, "Unknown type");
    check("unknown type is marked unknown", (await odd.getAttribute("data-box-type")) === "unknown");
    check("label shows the stored id as written", (await label(odd).innerText()) === "quantum-router", await label(odd).innerText());
    check("label explains itself on hover", (await label(odd).getAttribute("title"))!.includes("Unknown type"));
    check("unknown type uses the generic icon", (await iconClass(odd))!.includes("lucide-box"));
  });

  await test.step("changing the type redraws the box at once, and undo restores it", async () => {
    const b = box(page, "Orders API");
    await page.evaluate(() => {
      const store = window.__nestboard!.diagramStore.getState();
      const node = Object.values(store.diagram.nodes).find((n) => n.title === "Orders API")!;
      store.updateBox(node.id, { typeId: "cache" });
    });
    check("icon and label switch immediately", (await label(b).innerText()) === "CACHE" && (await iconClass(b))!.includes("lucide-zap"));
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    check("undo brings the old type back", (await label(b).innerText()) === "SERVICE / APPLICATION");
  });

  await test.step("saving keeps every type id, including the unknown one", async () => {
    const saved = await saveViaDownload(page);
    const ids = (saved.root.children as { typeId?: string }[]).map((c) => c.typeId);
    const original = (galleryJson.root.children as { typeId?: string }[]).map((c) => c.typeId);
    check("all type ids saved exactly as opened", JSON.stringify(ids) === JSON.stringify(original), JSON.stringify(ids));
    check("file saved in the current format", saved.schemaVersion === SCHEMA_VERSION);
    const { nodes } = await readDiagram(page);
    check("nothing was rewritten in memory either", nodes.some((n) => n.typeId === "quantum-router"));
  });
});
