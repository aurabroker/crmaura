export const confirmState = $state({
	open: false,
	title: '',
	message: '',
	detail: '',
	confirmLabel: 'Usuń',
	cancelLabel: 'Anuluj',
	danger: true
});

let resolver: ((v: boolean) => void) | null = null;

/**
 * Potwierdzenie w oknie aplikacji zamiast systemowego confirm() przeglądarki.
 * Zwraca true, gdy użytkownik potwierdził.
 */
export function askConfirm(opts: {
	title: string;
	message?: string;
	detail?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}): Promise<boolean> {
	// Nowe pytanie przerywa poprzednie (odpowiedź: anuluj).
	resolver?.(false);
	confirmState.title = opts.title;
	confirmState.message = opts.message ?? '';
	confirmState.detail = opts.detail ?? '';
	confirmState.confirmLabel = opts.confirmLabel ?? 'Usuń';
	confirmState.cancelLabel = opts.cancelLabel ?? 'Anuluj';
	confirmState.danger = opts.danger ?? true;
	confirmState.open = true;
	return new Promise((resolve) => (resolver = resolve));
}

export function resolveConfirm(value: boolean) {
	if (!confirmState.open) return;
	confirmState.open = false;
	const r = resolver;
	resolver = null;
	r?.(value);
}
