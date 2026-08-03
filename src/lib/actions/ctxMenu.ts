import { openCtxMenu, type CtxItem } from '$lib/stores/ctxmenu.svelte';

type ItemsProvider = (e: MouseEvent) => CtxItem[] | null | undefined;

export type CtxMenuOpts =
	| ItemsProvider
	| {
			items: ItemsProvider;
			// Funkcja — gdy tytuł zależy od miejsca kliknięcia (np. kafelek w kalendarzu).
			title?: string | ((e: MouseEvent) => string | undefined);
	  };

// Pola formularzy zostawiamy systemowi — użytkownik musi mieć wklej / sprawdzanie pisowni.
const NATIVE_ONLY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function ctxMenu(node: HTMLElement, opts: CtxMenuOpts) {
	let current = opts;

	function handle(e: MouseEvent) {
		// Shift + prawy przycisk = furtka do natywnego menu przeglądarki.
		if (e.shiftKey) return;
		if ((e.target as HTMLElement | null)?.closest(NATIVE_ONLY)) return;

		const provider = typeof current === 'function' ? current : current.items;
		const items = provider(e);
		if (!items?.length) return;

		e.preventDefault();
		e.stopPropagation();

		// Klawisz Menu / Shift+F10 nie niesie pozycji kursora — kotwiczymy do elementu.
		let x = e.clientX;
		let y = e.clientY;
		if (!x && !y) {
			const r = node.getBoundingClientRect();
			x = r.left + 24;
			y = r.top + Math.min(r.height, 28);
		}

		// Kolejność ma znaczenie: openCtxMenu sprząta po poprzednim celu,
		// więc podświetlenie dokładamy dopiero po nim.
		const rawTitle = typeof current === 'function' ? undefined : current.title;
		openCtxMenu(x, y, items, {
			title: typeof rawTitle === 'function' ? rawTitle(e) : rawTitle,
			onClose: () => node.classList.remove('ctx-target')
		});
		node.classList.add('ctx-target');
	}

	node.addEventListener('contextmenu', handle);

	return {
		update(next: CtxMenuOpts) {
			current = next;
		},
		destroy() {
			node.removeEventListener('contextmenu', handle);
			node.classList.remove('ctx-target');
		}
	};
}
