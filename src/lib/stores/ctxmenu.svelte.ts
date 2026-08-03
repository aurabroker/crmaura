import type { Component } from 'svelte';

export type CtxItem =
	| { separator: true }
	| {
			separator?: false;
			label: string;
			onSelect: () => void;
			icon?: Component<any>;
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

export function closeCtxMenu() {
	if (!ctxMenuState.open) return;
	ctxMenuState.open = false;
	ctxMenuState.items = [];
	ctxMenuState.title = '';
	onCloseCb?.();
	onCloseCb = null;
}
