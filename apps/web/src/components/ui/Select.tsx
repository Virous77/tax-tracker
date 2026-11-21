"use client";

import { Check, ChevronDown } from "lucide-react";
import {
	Children,
	isValidElement,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export type SelectOption = {
	value: string;
	label: ReactNode;
	/** Text used for typeahead when `label` is not a plain string. */
	textValue?: string;
	disabled?: boolean;
};

type SelectItemProps = {
	value: string;
	disabled?: boolean;
	textValue?: string;
	children: ReactNode;
};

/** Declarative option for `<Select>`; rendered by the parent listbox. */
export function SelectItem(_props: SelectItemProps): null {
	return null;
}

type SelectProps = {
	value: string;
	onValueChange?: (value: string) => void;
	options?: SelectOption[];
	children?: ReactNode;
	id?: string;
	name?: string;
	placeholder?: string;
	disabled?: boolean;
	size?: "sm" | "md";
	/** `surface` sits on the page canvas; `field` sits inside a card. */
	tone?: "field" | "surface";
	className?: string;
	"aria-label"?: string;
	"aria-labelledby"?: string;
	"aria-describedby"?: string;
	"aria-invalid"?: boolean;
};

const PAGE_STEP = 10;
const TYPEAHEAD_RESET_MS = 500;
const MAX_LIST_HEIGHT = 288;
const VIEWPORT_GAP = 8;

function optionsFromChildren(children: ReactNode): SelectOption[] {
	const out: SelectOption[] = [];
	Children.forEach(children, (child) => {
		if (!isValidElement<SelectItemProps>(child) || child.type !== SelectItem)
			return;
		const { value, disabled, textValue, children: label } = child.props;
		out.push({ value, label, disabled, textValue });
	});
	return out;
}

function optionText(option: SelectOption): string {
	if (option.textValue) return option.textValue;
	return typeof option.label === "string" || typeof option.label === "number"
		? String(option.label)
		: option.value;
}

function firstEnabled(options: SelectOption[], from: number, step: 1 | -1) {
	for (let i = from; i >= 0 && i < options.length; i += step) {
		if (!options[i]?.disabled) return i;
	}
	return -1;
}

function moveBy(options: SelectOption[], current: number, delta: number) {
	const target = Math.min(options.length - 1, Math.max(0, current + delta));
	const step = delta > 0 ? 1 : -1;
	const found = firstEnabled(options, target, step);
	if (found !== -1) return found;
	const back = firstEnabled(options, target, step === 1 ? -1 : 1);
	return back === -1 ? current : back;
}

function isPrintableKey(e: KeyboardEvent) {
	return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Select-only combobox following the WAI-ARIA APG pattern: focus stays on the
 * trigger and `aria-activedescendant` tracks the highlighted option.
 */
export function Select({
	value,
	onValueChange,
	options: optionsProp,
	children,
	id,
	name,
	placeholder = "Select…",
	disabled = false,
	size = "md",
	tone = "field",
	className = "",
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledby,
	"aria-describedby": ariaDescribedby,
	"aria-invalid": ariaInvalid,
}: SelectProps) {
	const options = optionsProp ?? optionsFromChildren(children);
	const autoId = useId();
	const triggerId = id ?? `${autoId}-trigger`;
	const listboxId = `${autoId}-listbox`;
	const optionId = (index: number) => `${autoId}-option-${index}`;

	const triggerRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const typeahead = useRef({ buffer: "", timer: 0 });

	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [placement, setPlacement] = useState<{
		top: number;
		left: number;
		width: number;
		maxHeight: number;
	} | null>(null);

	const selectedIndex = options.findIndex((o) => o.value === value);
	const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

	const [listLabel, setListLabel] = useState<string>();

	const openAt = useCallback(
		(index: number) => {
			if (disabled) return;
			const label = triggerRef.current?.labels?.[0]?.textContent?.trim();
			setListLabel(label || undefined);
			setActiveIndex(index >= 0 ? index : firstEnabled(options, 0, 1));
			setOpen(true);
		},
		[disabled, options],
	);

	const close = useCallback((refocus: boolean) => {
		typeahead.current.buffer = "";
		setOpen(false);
		setPlacement(null);
		if (refocus) triggerRef.current?.focus();
	}, []);

	const commit = useCallback(
		(index: number, refocus = true) => {
			const option = options[index];
			if (option && !option.disabled && option.value !== value) {
				onValueChange?.(option.value);
			}
			close(refocus);
		},
		[options, value, onValueChange, close],
	);

	const matchTypeahead = useCallback(
		(key: string, from: number) => {
			const state = typeahead.current;
			window.clearTimeout(state.timer);
			state.timer = window.setTimeout(() => {
				state.buffer = "";
			}, TYPEAHEAD_RESET_MS);
			state.buffer += key.toLowerCase();
			const repeated = [...state.buffer].every((c) => c === state.buffer[0]);
			const search = repeated ? state.buffer[0] : state.buffer;
			const start = repeated || state.buffer.length === 1 ? from + 1 : from;
			for (let i = 0; i < options.length; i++) {
				const index = (start + i) % options.length;
				const option = options[index];
				if (
					option &&
					!option.disabled &&
					optionText(option)
						.toLowerCase()
						.startsWith(search ?? "")
				) {
					return index;
				}
			}
			return -1;
		},
		[options],
	);

	useEffect(() => () => window.clearTimeout(typeahead.current.timer), []);

	const position = useCallback(() => {
		const trigger = triggerRef.current;
		const list = listRef.current;
		if (!trigger || !list) return;
		const rect = trigger.getBoundingClientRect();
		const viewportW = document.documentElement.clientWidth;
		const viewportH = window.innerHeight;
		const spaceBelow = viewportH - rect.bottom - VIEWPORT_GAP;
		const spaceAbove = rect.top - VIEWPORT_GAP;
		const natural = Math.min(list.scrollHeight, MAX_LIST_HEIGHT);
		const flip = spaceBelow < natural && spaceAbove > spaceBelow;
		const maxHeight = Math.max(
			96,
			Math.min(MAX_LIST_HEIGHT, flip ? spaceAbove : spaceBelow) - 4,
		);
		const height = Math.min(natural, maxHeight);
		const width = Math.min(
			Math.max(rect.width, list.scrollWidth),
			viewportW - VIEWPORT_GAP * 2,
		);
		const left = Math.min(
			Math.max(VIEWPORT_GAP, rect.left),
			viewportW - VIEWPORT_GAP - width,
		);
		const top = flip ? rect.top - 4 - height : rect.bottom + 4;
		// A transformed ancestor can move the fixed containing block; measure
		// where the current offsets land and correct for it.
		const current = list.getBoundingClientRect();
		const originTop = current.top - (Number.parseFloat(list.style.top) || 0);
		const originLeft = current.left - (Number.parseFloat(list.style.left) || 0);
		setPlacement({
			top: top - originTop,
			left: left - originLeft,
			width,
			maxHeight,
		});
	}, []);

	useLayoutEffect(() => {
		if (!open) return;
		position();
		const onMove = (e: Event) => {
			if (e.target !== listRef.current) position();
		};
		window.addEventListener("resize", onMove);
		window.addEventListener("scroll", onMove, true);
		return () => {
			window.removeEventListener("resize", onMove);
			window.removeEventListener("scroll", onMove, true);
		};
	}, [open, position]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (
				triggerRef.current?.contains(target) ||
				listRef.current?.contains(target)
			)
				return;
			close(false);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () =>
			document.removeEventListener("pointerdown", onPointerDown, true);
	}, [open, close]);

	const placed = placement !== null;
	useLayoutEffect(() => {
		if (!open || activeIndex < 0 || !placed) return;
		const list = listRef.current;
		const el = list?.querySelector<HTMLElement>(
			`[id="${autoId}-option-${activeIndex}"]`,
		);
		if (!list || !el) return;
		if (el.offsetTop < list.scrollTop) {
			list.scrollTop = el.offsetTop;
		} else if (
			el.offsetTop + el.offsetHeight >
			list.scrollTop + list.clientHeight
		) {
			list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
		}
	}, [open, activeIndex, placed, autoId]);

	function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
		const last = options.length - 1;
		if (!open) {
			switch (e.key) {
				case "ArrowDown":
				case "ArrowUp":
				case "Enter":
				case " ":
					e.preventDefault();
					openAt(selectedIndex);
					return;
				case "Home":
					e.preventDefault();
					openAt(firstEnabled(options, 0, 1));
					return;
				case "End":
					e.preventDefault();
					openAt(firstEnabled(options, last, -1));
					return;
				default:
					if (isPrintableKey(e)) {
						e.preventDefault();
						const match = matchTypeahead(e.key, selectedIndex);
						openAt(match >= 0 ? match : selectedIndex);
					}
					return;
			}
		}

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				if (e.altKey) return;
				setActiveIndex((i) => moveBy(options, i, 1));
				return;
			case "ArrowUp":
				e.preventDefault();
				if (e.altKey) {
					commit(activeIndex);
					return;
				}
				setActiveIndex((i) => moveBy(options, i, -1));
				return;
			case "Home":
				e.preventDefault();
				setActiveIndex(firstEnabled(options, 0, 1));
				return;
			case "End":
				e.preventDefault();
				setActiveIndex(firstEnabled(options, last, -1));
				return;
			case "PageDown":
				e.preventDefault();
				setActiveIndex((i) => moveBy(options, i, PAGE_STEP));
				return;
			case "PageUp":
				e.preventDefault();
				setActiveIndex((i) => moveBy(options, i, -PAGE_STEP));
				return;
			case "Enter":
			case " ":
				e.preventDefault();
				if (e.key === " " && typeahead.current.buffer) {
					const match = matchTypeahead(" ", activeIndex);
					if (match >= 0) setActiveIndex(match);
					return;
				}
				commit(activeIndex);
				return;
			case "Escape":
				e.preventDefault();
				e.stopPropagation();
				close(true);
				return;
			case "Tab":
				commit(activeIndex, false);
				return;
			default:
				if (isPrintableKey(e)) {
					e.preventDefault();
					const match = matchTypeahead(e.key, activeIndex);
					if (match >= 0) setActiveIndex(match);
				}
		}
	}

	const sizeClass =
		size === "sm" ? "px-2 py-1 text-xs gap-1.5" : "px-2.5 py-1.5 text-sm gap-2";
	const toneClass =
		tone === "surface" ? "bg-[var(--bg-surface)]" : "bg-[var(--bg-canvas)]";

	return (
		<>
			<button
				ref={triggerRef}
				id={triggerId}
				type="button"
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listboxId : undefined}
				aria-activedescendant={
					open && activeIndex >= 0 ? optionId(activeIndex) : undefined
				}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledby}
				aria-describedby={ariaDescribedby}
				aria-invalid={ariaInvalid || undefined}
				data-value={value}
				data-state={open ? "open" : "closed"}
				disabled={disabled}
				onClick={() => (open ? close(true) : openAt(selectedIndex))}
				onKeyDown={onKeyDown}
				onBlur={(e) => {
					if (open && !listRef.current?.contains(e.relatedTarget as Node)) {
						close(false);
					}
				}}
				className={`inline-flex min-w-0 items-center justify-between rounded border border-[var(--border)] text-left text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-secondary)] disabled:hover:border-[var(--border)] aria-[invalid=true]:border-[var(--loss)] ${sizeClass} ${toneClass} ${className}`}
			>
				<span
					className={`truncate ${selected ? "" : "text-[var(--text-muted)]"}`}
				>
					{selected ? selected.label : placeholder}
				</span>
				<ChevronDown
					className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
					aria-hidden="true"
				/>
			</button>
			{name ? <input type="hidden" name={name} value={value} /> : null}
			{open ? (
				<div
					ref={listRef}
					id={listboxId}
					role="listbox"
					aria-label={ariaLabelledby ? undefined : (ariaLabel ?? listLabel)}
					aria-labelledby={ariaLabelledby}
					tabIndex={-1}
					onMouseDown={(e) => e.preventDefault()}
					style={
						placement
							? {
									top: placement.top,
									left: placement.left,
									minWidth: placement.width,
									maxWidth: `calc(100vw - ${VIEWPORT_GAP * 2}px)`,
									maxHeight: placement.maxHeight,
								}
							: { top: 0, left: 0, visibility: "hidden" }
					}
					className="fixed z-50 overflow-y-auto overscroll-contain rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-1 text-sm text-[var(--text-primary)] shadow-lg"
				>
					{options.map((option, index) => {
						const isSelected = index === selectedIndex;
						const isActive = index === activeIndex;
						return (
							// biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the trigger via aria-activedescendant (APG select-only combobox)
							<div
								key={option.value}
								id={optionId(index)}
								role="option"
								tabIndex={-1}
								aria-selected={isSelected}
								aria-disabled={option.disabled || undefined}
								data-value={option.value}
								data-active={isActive || undefined}
								onPointerMove={() => {
									if (!option.disabled && !isActive) setActiveIndex(index);
								}}
								onClick={() => {
									if (!option.disabled) commit(index);
								}}
								className={`relative flex cursor-default items-center rounded py-1.5 pr-8 pl-2 select-none ${
									size === "sm" ? "text-xs" : ""
								} ${isActive ? "bg-[var(--bg-hover)]" : ""} ${
									option.disabled
										? "cursor-not-allowed text-[var(--text-muted)] opacity-60"
										: ""
								} ${isSelected ? "font-medium" : ""}`}
							>
								<span className="min-w-0 break-words">{option.label}</span>
								{isSelected ? (
									<Check
										className="absolute right-2 h-4 w-4 text-[var(--accent-text)]"
										aria-hidden="true"
									/>
								) : null}
							</div>
						);
					})}
				</div>
			) : null}
		</>
	);
}
