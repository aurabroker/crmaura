<script lang="ts">
	// Dokumenty polisy (PDF w Cloudflare R2): lista, otwieranie, dodawanie i usuwanie.
	import { appState, isAdmin } from '$lib/stores/app.svelte';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { fmtDzien } from '$lib/utils';
	import {
		RODZAJ_PLIKU, magazynDostepny, otworzPlikPolisy, rozmiar, usunPlikPolisy, wczytajPlikiPolis, wyslijPdfPolisy, type PlikPolisy
	} from '$lib/plikiPolis';
	import { FileText, Upload, Trash2, ExternalLink } from 'lucide-svelte';

	let { polisaId }: { polisaId: string } = $props();

	let pliki = $state<PlikPolisy[]>([]);
	let wczytane = $state(false);
	let dostepny = $state(false);
	let rodzaj = $state<PlikPolisy['rodzaj']>('polisa');
	let wysylanie = $state(false);
	let blad = $state('');
	let pole = $state<HTMLInputElement | null>(null);

	async function wczytaj(id: string) {
		const [lista, ok] = await Promise.all([wczytajPlikiPolis([id]), magazynDostepny()]);
		if (id !== polisaId) return;
		pliki = lista;
		dostepny = ok;
		wczytane = true;
	}
	$effect(() => { void wczytaj(polisaId); });

	const kto = (id: string | null) => (id ? appState.brokers.find((b) => b.id === id)?.imie_nazwisko ?? null : null);

	async function dodaj(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const plik = input.files?.[0];
		input.value = '';
		if (!plik) return;
		blad = '';
		wysylanie = true;
		try {
			const nowy = await wyslijPdfPolisy(polisaId, plik, { rodzaj });
			pliki = [nowy, ...pliki];
			ctxToast(`Dodano: ${nowy.nazwa}`);
		} catch (err) {
			blad = (err as Error).message;
		} finally {
			wysylanie = false;
		}
	}

	async function otworz(p: PlikPolisy) {
		blad = '';
		try { await otworzPlikPolisy(p.id); } catch (err) { blad = (err as Error).message; }
	}

	async function usun(p: PlikPolisy) {
		const ok = await askConfirm({ title: 'Usunąć dokument?', message: p.nazwa, detail: 'Plik zostanie usunięty z magazynu — nie da się go przywrócić.', confirmLabel: 'Usuń dokument' });
		if (!ok) return;
		try {
			await usunPlikPolisy(p.id);
			pliki = pliki.filter((x) => x.id !== p.id);
			ctxToast(`Usunięto: ${p.nazwa}`);
		} catch (err) {
			blad = (err as Error).message;
		}
	}
</script>

{#if wczytane && (pliki.length > 0 || dostepny || isAdmin(appState.profile))}
	<section aria-labelledby="dokumenty-polisy" class="bg-white border border-line rounded-xl overflow-hidden">
		<div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line-soft">
			<FileText size={16} class="text-ink-3" />
			<h2 id="dokumenty-polisy" class="text-[15px] font-semibold text-ink">Dokumenty</h2>
			<span class="text-xs text-ink-3">{pliki.length ? `${pliki.length} ${pliki.length === 1 ? 'plik' : pliki.length < 5 ? 'pliki' : 'plików'}` : 'brak plików'}</span>
			{#if dostepny}
				<div class="ml-auto flex items-center gap-2">
					<label class="sr-only" for="rodzaj-dokumentu">Rodzaj dokumentu</label>
					<select id="rodzaj-dokumentu" bind:value={rodzaj} class="h-8 px-2 border border-line rounded-lg bg-white text-[13px]">
						{#each Object.entries(RODZAJ_PLIKU) as [k, l]}<option value={k}>{l}</option>{/each}
					</select>
					<button onclick={() => pole?.click()} disabled={wysylanie} class="h-8 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover disabled:opacity-60">
						<Upload size={14} /> {wysylanie ? 'Wysyłanie…' : 'Dodaj PDF'}
					</button>
					<input bind:this={pole} type="file" accept="application/pdf,.pdf" onchange={dodaj} class="hidden" />
				</div>
			{/if}
		</div>
		{#if blad}<p class="mx-4 mt-3 text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}
		{#if !dostepny}
			<p class="px-4 py-3 text-[13px] text-ink-3">Magazyn plików (Cloudflare R2) nie jest jeszcze podpięty — po podpięciu PDF z importu będzie zapisywany tutaj automatycznie.</p>
		{/if}
		{#if pliki.length}
			<ul>
				{#each pliki as p (p.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-t border-line-soft first:border-t-0">
						<span class="flex-[1_1_200px] min-w-0">
							<button onclick={() => otworz(p)} class="block max-w-full truncate text-left text-[13px] font-medium text-accent-text hover:underline">{p.nazwa}</button>
							<span class="block text-xs text-ink-3">
								{RODZAJ_PLIKU[p.rodzaj]} · {rozmiar(p.rozmiar)} · {fmtDzien(p.created_at.slice(0, 10), true)}{p.zrodlo === 'import_pdf' ? ' · z importu PDF' : ''}{kto(p.dodal) ? ` · ${kto(p.dodal)}` : ''}
							</span>
						</span>
						<span class="ml-auto flex items-center">
							<button onclick={() => otworz(p)} title="Otwórz" aria-label="Otwórz {p.nazwa}" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><ExternalLink size={15} /></button>
							{#if dostepny}
								<button onclick={() => usun(p)} title="Usuń" aria-label="Usuń {p.nazwa}" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-danger hover:bg-danger-soft"><Trash2 size={15} /></button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
