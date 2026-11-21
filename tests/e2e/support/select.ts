import { expect, type Locator } from "@playwright/test";

type OptionPick = string | { label: string | RegExp };

/**
 * Picks an option in the app's custom Select (an ARIA select-only combobox),
 * the way a user would: open it, then click the option. A string matches the
 * option's value; `{ label }` matches its visible name.
 */
export async function chooseOption(locator: Locator, option: OptionPick) {
	// While open, the listbox carries the same label, so pin the trigger by id.
	const triggerId = await locator.getAttribute("id");
	const combobox = locator.page().locator(`[id="${triggerId}"]`);
	await combobox.click();
	await expect(combobox).toHaveAttribute("aria-expanded", "true");
	const listboxId = await combobox.getAttribute("aria-controls");
	const listbox = combobox.page().locator(`[id="${listboxId}"]`);
	const target =
		typeof option === "string"
			? listbox.locator(`[role=option][data-value=${JSON.stringify(option)}]`)
			: listbox.getByRole("option", {
					name: option.label,
					exact: typeof option.label === "string",
				});
	await target.click();
	await expect(combobox).toHaveAttribute("aria-expanded", "false");
}

/** Every option value of a custom Select; opens it and closes it again. */
export async function listOptionValues(locator: Locator) {
	const triggerId = await locator.getAttribute("id");
	const combobox = locator.page().locator(`[id="${triggerId}"]`);
	await combobox.click();
	await expect(combobox).toHaveAttribute("aria-expanded", "true");
	const listboxId = await combobox.getAttribute("aria-controls");
	const values = await combobox
		.page()
		.locator(`[id="${listboxId}"] [role=option]`)
		.evaluateAll((opts) => opts.map((o) => o.getAttribute("data-value") ?? ""));
	await combobox.press("Escape");
	await expect(combobox).toHaveAttribute("aria-expanded", "false");
	return values;
}

/** The selected value of a custom Select (what `toHaveValue` read on a native select). */
export const SELECT_VALUE = "data-value";
