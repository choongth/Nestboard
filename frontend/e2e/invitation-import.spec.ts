import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, ORG_PATH, test, watchConsole } from "./helpers";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Invite people from a CSV file" });

async function chooseFile(page: Page, text: string) {
  await dialog(page).getByLabel("CSV file").setInputFiles({ name: "team.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
}

test("inviting a team from a CSV file", async ({ page, browser }) => {
  const errors = watchConsole(page);
  const tag = Date.now();
  const bob = `bob-${tag}@example.com`;
  const carol = `carol-${tag}@example.com`;
  await page.goto(`${ORG_PATH}#invitations`);
  await page.getByRole("button", { name: "Import from CSV…" }).click();
  await expect(dialog(page)).toBeVisible();

  await test.step("a file that can't be used says why, and nothing is invited", async () => {
    await chooseFile(page, "name,role\nBob,member\n");
    await expect(dialog(page).getByRole("alert")).toContainText("needs an email column");
  });

  await test.step("the preview shows every row, and why some are skipped", async () => {
    await chooseFile(
      page,
      `email,name,job title,role\n${bob},Bob Lee,Developer,member\nnope,Nope,,\n${carol},,Architect,\n${bob.toUpperCase()},Again,,\n`,
    );
    await expect(dialog(page)).toContainText("team.csv: 2 people to invite, 2 skipped");
    await expect(dialog(page).locator("[data-problem]")).toHaveCount(2);
    await expect(dialog(page).locator('[data-import-row="3"] [data-problem="invalid_email"]')).toBeVisible();
    await expect(dialog(page).locator('[data-import-row="5"] [data-problem="duplicate_email"]')).toBeVisible();
  });

  await test.step("inviting gives the links once, ready for a mail merge", async () => {
    await dialog(page).getByRole("button", { name: "Invite 2 people" }).click();
    await expect(dialog(page)).toContainText("Invited 2 people.");
    const download = page.waitForEvent("download");
    await dialog(page).getByRole("button", { name: "Download links (CSV)" }).click();
    const file = readFileSync(await (await download).path(), "utf8");
    const lines = file.trim().split("\r\n");
    expect(lines[0]).toBe("email,name,job title,role,link,expires");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(new RegExp(`^${bob},Bob Lee,Developer,member,http://[^,]+/invite/[\\w-]+,\\d{4}-\\d{2}-\\d{2}$`));
    expect(lines[2]).toContain(`${carol},,Architect,member,`);

    // The links were kept, so closing doesn't ask.
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("region", { name: "Invitations" })).toContainText(`Bob Lee · Member · Developer · for ${bob}`);

    // Bob's link fills in his name and email.
    const link = lines[1]!.split(",")[4]!;
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const invitee = await context.newPage();
    await invitee.goto(link);
    await expect(invitee.getByLabel("Your name")).toHaveValue("Bob Lee");
    await expect(invitee.getByLabel("Email")).toHaveValue(bob);
    await context.close();
  });

  await test.step("closing before keeping the links asks first", async () => {
    await page.getByRole("button", { name: "Import from CSV…" }).click();
    await chooseFile(page, `email\ndan-${tag}@example.com\n`);
    await dialog(page).getByRole("button", { name: "Invite 1 person" }).click();
    await expect(dialog(page)).toContainText("Invited 1 person.");
    await page.keyboard.press("Escape");
    const confirm = page.getByRole("alertdialog", { name: "Close without the links?" });
    await expect(confirm).toBeVisible();
    // Cancel goes back to the links.
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page).getByRole("button", { name: "Download links (CSV)" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await confirm.getByRole("button", { name: "Close anyway" }).click();
    await expect(dialog(page)).toBeHidden();
  });

  expect(errors).toEqual([]);
});
