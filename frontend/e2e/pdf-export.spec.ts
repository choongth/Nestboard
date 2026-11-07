// File › Export as PDF…: the server makes the report from the saved diagram.

import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { check, createBox, enter, fileMenu, goBack, openApp, test } from "./helpers";

const fileLabel = (page: Page) => page.getByRole("button", { name: /^File:/ }).getAttribute("aria-label");

/** Clicks Export PDF in the open dialog; the downloaded file's name and first bytes. */
async function exportNow(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export PDF" }).click(),
  ]);
  const bytes = readFileSync((await download.path())!);
  return { name: download.suggestedFilename(), start: bytes.subarray(0, 5).toString("latin1"), size: bytes.length };
}

test("export a diagram as a PDF", async ({ page }) => {
  await openApp(page);
  await createBox(page, 400, 300, "Payments");
  await enter(page, "Payments");
  await createBox(page, 500, 350, "Ledger");
  await goBack(page);

  await test.step("a new diagram, on the server since its first box, downloads at once", async () => {
    await fileMenu(page, "Export as PDF…");
    const dialog = page.getByRole("dialog", { name: "Export as PDF" });
    check("nothing to save first", !(await dialog.getByText("will be saved first").isVisible()));
    check("at the root there is nothing to narrow down", !(await dialog.getByText("Only inside").isVisible()));
    check("A4 is chosen", await dialog.getByRole("radio", { name: /^A4/ }).isChecked());

    const file = await exportNow(page);
    check("a PDF named after the diagram", file.name === "Untitled.pdf" && file.start === "%PDF-", JSON.stringify(file));
    check("the dialog closes", !(await dialog.isVisible()));
    check("the diagram is saved now", (await fileLabel(page)) === "File: Untitled", String(await fileLabel(page)));
  });

  await test.step("inside a box, the PDF can cover just that box, on letter paper", async () => {
    await enter(page, "Payments");
    await fileMenu(page, "Export as PDF…");
    const dialog = page.getByRole("dialog", { name: "Export as PDF" });
    check("nothing unsaved, so no note", !(await dialog.getByText("will be saved first").isVisible()));
    check("the whole diagram is the default", await dialog.getByRole("radio", { name: /^The whole diagram/ }).isChecked());
    await dialog.getByRole("radio", { name: /^Only inside Payments/ }).check();
    await dialog.getByRole("radio", { name: /^US Letter/ }).check();

    const file = await exportNow(page);
    check("named after the box", file.name === "Untitled - Payments.pdf" && file.start === "%PDF-", JSON.stringify(file));
  });

  await test.step("Cancel exports nothing", async () => {
    let downloads = 0;
    page.on("download", () => downloads++);
    await fileMenu(page, "Export as PDF…");
    await page.getByRole("dialog", { name: "Export as PDF" }).getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    check("no download", downloads === 0);
  });
});
