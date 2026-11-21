import type { Locator, Page } from "@playwright/test";
import { expect, settled, test } from "./support/fixtures";
import { SELECT_VALUE } from "./support/select";

test.beforeEach(async ({ api, page }) => {
	await api.reset();
	await page.goto("/settings");
	await settled(page);
});

const combobox = (page: Page, name: string) =>
	page.getByRole("combobox", { name, exact: true });

async function listboxOf(trigger: Locator) {
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	const id = await trigger.getAttribute("aria-controls");
	return trigger.page().locator(`[id="${id}"]`);
}

function activeOption(trigger: Locator) {
	return trigger.page().locator('[role="option"][data-active]');
}

test("roles and states follow the select-only combobox pattern", async ({
	page,
}) => {
	const surcharge = combobox(page, "Surcharge rate");
	await expect(surcharge).toHaveAttribute("aria-haspopup", "listbox");
	await expect(surcharge).toHaveAttribute("aria-expanded", "false");
	await expect(surcharge).toHaveAttribute(SELECT_VALUE, "0");

	await surcharge.click();
	const listbox = await listboxOf(surcharge);
	await expect(listbox).toHaveRole("listbox");
	await expect(listbox).toHaveAccessibleName("Surcharge rate");
	await expect(listbox.getByRole("option")).toHaveCount(5);
	const selected = listbox.getByRole("option", { selected: true });
	await expect(selected).toHaveText(/^0%/);
	await expect(selected).toHaveAttribute(
		"id",
		(await surcharge.getAttribute("aria-activedescendant")) ?? "",
	);

	await page.getByRole("heading", { level: 1 }).click();
	await expect(surcharge).toHaveAttribute("aria-expanded", "false");
	await expect(listbox).toBeHidden();
	await expect(surcharge).toHaveAttribute(SELECT_VALUE, "0");

	await expect(combobox(page, "Lot matching method")).toBeDisabled();
});

test("keyboard: open, move, Escape returns focus without changing the value", async ({
	page,
}) => {
	const surcharge = combobox(page, "Surcharge rate");
	await surcharge.focus();
	await page.keyboard.press("ArrowDown");
	await listboxOf(surcharge);
	await expect(activeOption(surcharge)).toHaveText(/^0%/);

	await page.keyboard.press("End");
	await expect(activeOption(surcharge)).toHaveText(/^37%/);
	await page.keyboard.press("Home");
	await expect(activeOption(surcharge)).toHaveText(/^0%/);
	await page.keyboard.press("PageDown");
	await expect(activeOption(surcharge)).toHaveText(/^37%/);
	await page.keyboard.press("ArrowUp");
	await expect(activeOption(surcharge)).toHaveText(/^25%/);

	await page.keyboard.press("Escape");
	await expect(surcharge).toHaveAttribute("aria-expanded", "false");
	await expect(surcharge).toBeFocused();
	await expect(surcharge).toHaveAttribute(SELECT_VALUE, "0");
});

test("keyboard: typeahead and Enter select; Tab selects and moves on", async ({
	page,
}) => {
	const surcharge = combobox(page, "Surcharge rate");
	await surcharge.focus();
	await page.keyboard.press("2");
	await expect(surcharge).toHaveAttribute("aria-expanded", "true");
	await expect(activeOption(surcharge)).toHaveText(/^25%/);
	await page.keyboard.press("Enter");
	await expect(surcharge).toHaveAttribute("aria-expanded", "false");
	await expect(surcharge).toHaveAttribute(SELECT_VALUE, "0.25");
	await expect(surcharge).toContainText("25% (above ₹2 crore – ₹5 crore)");
	await expect(surcharge).toBeFocused();

	await page.keyboard.press("1");
	await expect(activeOption(surcharge)).toHaveText(/^10%/);
	await page.keyboard.press("1");
	await expect(activeOption(surcharge)).toHaveText(/^15%/);
	await page.keyboard.press("Tab");
	await expect(surcharge).toHaveAttribute("aria-expanded", "false");
	await expect(surcharge).toHaveAttribute(SELECT_VALUE, "0.15");
	await expect(surcharge).not.toBeFocused();

	const fee = combobox(page, "Fee & GST treatment");
	await fee.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Space");
	await expect(fee).toHaveAttribute(SELECT_VALUE, "include");
});

test("the popover stays inside a 375px viewport", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 700 });
	const fee = combobox(page, "Fee & GST treatment");
	await fee.scrollIntoViewIfNeeded();
	await fee.click();
	const listbox = await listboxOf(fee);
	const box = await listbox.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(375);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual(700);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(375);
});
