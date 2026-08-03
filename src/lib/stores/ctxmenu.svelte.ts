import type { Component, SvelteComponent } from 'svelte';

// lucide-svelte 1.x eksportuje ikony jako klasy legacy (SvelteComponentTyped),
// a nie jako funkcyjne komponenty Svelte 5 — stąd unia obu wariantów.
export type IconLike = Component<any, any, any> | typeof SvelteComponent<any, any, any>;

export type CtxItem =
	| { separator: true }
	| {
			separator?: false;
			label: string;
			onSelect: () => void;
			icon?: IconLike;
			hint?: string;
			danger?: boolean;
			disabled?: boolean;
	  };

export const ctxMenuState = $state({
	open: false,
	x: 0,
	y: 0,
	title: '',
	items: [] as CtxItem[]
});

let onCloseCb: (() => void) | null = null;

export function openCtxMenu(
	x: number,
	y: number,
	items: CtxItem[],
	opts: { title?: string; onClose?: () => void } = {}
) {
	// Prawy klik na innym obiekcie przy otwartym menu — najpierw sprzątamy poprzedni.
	onCloseCb?.();
	onCloseCb = opts.onClose ?? null;
	ctxMenuState.x = x;
	ctxMenuState.y = y;
	ctxMenuState.title = opts.title ?? '';
	ctxMenuState.items = items;
	ctxMenuState.open = true;
}

// Krótki komunikat po akcji z menu (renderowany przez ContextMenu.svelte).
export const ctxToastState = $state({ msg: '' });
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function ctxToast(msg: string) {
	ctxToastState.msg = msg;
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (ctxToastState.msg = ''), 1800);
}

export async function ctxCopy(value: string | null | undefined, label: string) {
	if (!value) { ctxToast(`Brak: ${label}`); return; }
	try {
		await navigator.clipboard.writeText(value);
		ctxToast(`Skopiowano ${label}`);
	} catch {
		ctxToast('Nie udało się skopiować');
	}
}

export function closeCtxMenu() {
	if (!ctxMenuState.open) return;
	ctxMenuState.open = false;
	ctxMenuState.items = [];
	ctxMenuState.title = '';
	onCloseCb?.();
	onCloseCb = null;
}
