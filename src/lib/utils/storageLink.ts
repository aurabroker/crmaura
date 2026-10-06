import { sb } from '$lib/supabase';
import { ctxToast } from '$lib/stores/ctxmenu.svelte';

// Pliki z prywatnych bucketów (PDF APK, zestawienia prowizyjne) otwieramy przez podpisany link,
// tworzony w chwili kliknięcia. W bazie trzymamy ścieżkę pliku w buckecie; starsze wiersze mają
// pełny adres „…/storage/v1/object/public/<bucket>/<ścieżka>”, z którego odczytujemy ścieżkę.

export const OPEN_LINK_TTL = 5 * 60;
export const SHARE_LINK_TTL = 7 * 24 * 60 * 60;

export function storagePath(bucket: string, stored: string | null | undefined): string | null {
	if (!stored) return null;
	if (!/^https?:\/\//i.test(stored)) return stored.replace(/^\/+/, '') || null;
	let pathname: string;
	try {
		pathname = new URL(stored).pathname;
	} catch {
		return null;
	}
	const m = pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
	if (!m || m[1] !== bucket) return null;
	try {
		return decodeURIComponent(m[2]);
	} catch {
		return null;
	}
}

export async function signedStorageUrl(bucket: string, stored: string | null | undefined, expiresIn: number): Promise<string> {
	const path = storagePath(bucket, stored);
	if (!path) throw new Error('Nieprawidłowy adres pliku');
	const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
	if (error || !data?.signedUrl) throw error ?? new Error('Nie udało się utworzyć linku do pliku');
	return data.signedUrl;
}

// Kartę otwieramy od razu, w obsłudze kliknięcia: otwarta dopiero po await zostałaby
// zablokowana jako wyskakujące okno.
export async function openStoredFile(bucket: string, stored: string | null | undefined): Promise<void> {
	const win = window.open('about:blank', '_blank');
	try {
		const url = await signedStorageUrl(bucket, stored, OPEN_LINK_TTL);
		if (win) {
			win.opener = null;
			win.location.href = url;
		} else {
			window.location.assign(url);
		}
	} catch (e) {
		win?.close();
		throw e;
	}
}

// Link do przekazania dalej (np. klientowi) — ważny SHARE_LINK_TTL. ClipboardItem z obietnicą
// pozwala Safari zapisać schowek mimo oczekiwania na link; gdzie go brak, zapisujemy po await.
export async function copyStoredFileLink(bucket: string, stored: string | null | undefined, label: string): Promise<void> {
	const link = signedStorageUrl(bucket, stored, SHARE_LINK_TTL);
	try {
		if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
			await navigator.clipboard.write([
				new ClipboardItem({ 'text/plain': link.then((u) => new Blob([u], { type: 'text/plain' })) })
			]);
		} else {
			await navigator.clipboard.writeText(await link);
		}
		ctxToast(`Skopiowano ${label} (ważny 7 dni)`);
	} catch {
		try {
			await navigator.clipboard.writeText(await link);
			ctxToast(`Skopiowano ${label} (ważny 7 dni)`);
		} catch {
			ctxToast(`Nie udało się skopiować: ${label}`);
		}
	}
}
