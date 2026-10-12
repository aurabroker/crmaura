<script lang="ts">
	// Pliki z maili do klientów (pliki.auraexpert.pl/media/…): dokumenty programu linkowane w szablonach Resend
	// i grafiki. Administrator wgrywa / podmienia plik — adres się nie zmienia, więc szablonów nie trzeba poprawiać.
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { fmtDzien } from '$lib/utils';
	import { podmienPlikPubliczny, rozmiar, wczytajPlikiPubliczne, type PlikPubliczny } from '$lib/plikiPolis';
	import { Copy, ExternalLink, Link2, Upload } from 'lucide-svelte';

	let pliki = $state<PlikPubliczny[]>([]);
	let mozeZmieniac = $state(false);
	let blad = $state('');
	let wysylany = $state<string | null>(null);

	async function wczytaj() {
		try {
			const d = await wczytajPlikiPubliczne();
			pliki = d.pliki;
			mozeZmieniac = d.moze_zmieniac;
		} catch {
			pliki = [];
		}
	}
	$effect(() => { void wczytaj(); });

	const brakuje = $derived(pliki.filter((p) => !p.w_magazynie && !p.ze_zrodla).length);

	async function podmien(p: PlikPubliczny, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const plik = input.files?.[0];
		input.value = '';
		if (!plik) return;
		blad = '';
		wysylany = p.sciezka;
		try {
			const nowy = await podmienPlikPubliczny(p.sciezka, plik);
			pliki = pliki.map((x) => (x.sciezka === p.sciezka ? nowy : x));
			ctxToast(`Zapisano: ${p.opis}`);
		} catch (err) {
			blad = (err as Error).message;
		} finally {
			wysylany = null;
		}
	}

	async function kopiuj(p: PlikPubliczny) {
		try {
			await navigator.clipboard.writeText(p.adres);
			ctxToast('Skopiowano link');
		} catch {
			ctxToast(p.adres);
		}
	}
</script>

{#if pliki.length}
	<section aria-labelledby="pliki-w-mailach" class="bg-white border border-line rounded-xl overflow-hidden">
		<div class="flex flex-wrap items-start gap-2 px-5 py-4 border-b border-line-soft">
			<Link2 size={18} class="text-ink-3 mt-0.5" />
			<div class="min-w-0 flex-1">
				<h2 id="pliki-w-mailach" class="text-lg font-semibold text-slate-900">Pliki w mailach do klientów</h2>
				<p class="text-sm text-slate-500">
					Dokumenty i grafiki, do których prowadzą linki w szablonach Resend (pliki.auraexpert.pl). Podmiana pliku nie zmienia linku.
					{#if brakuje}<span class="text-warn font-medium"> Brakuje {brakuje} {brakuje === 1 ? 'pliku' : 'plików'} — link w mailu nie zadziała, dopóki go nie wgrasz.</span>{/if}
				</p>
			</div>
		</div>
		{#if blad}<p class="mx-5 mt-3 text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}
		<ul>
			{#each pliki as p (p.sciezka)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 border-t border-line-soft first:border-t-0">
					<span class="flex-[1_1_260px] min-w-0">
						<span class="block text-[13px] font-medium text-ink">{p.opis}</span>
						<span class="block text-xs text-ink-3 truncate">
							{#if p.w_magazynie}
								{p.rozmiar != null ? rozmiar(p.rozmiar) : ''}{p.wgrano ? ` · ${fmtDzien(p.wgrano.slice(0, 10), true)}` : ''} · {p.adres.replace('https://', '')}
							{:else if p.ze_zrodla}
								skopiuje się przy pierwszym otwarciu linku · {p.adres.replace('https://', '')}
							{:else}
								<span class="text-warn font-medium">brak pliku</span> · {p.adres.replace('https://', '')}
							{/if}
						</span>
					</span>
					<span class="ml-auto flex items-center gap-1">
						<button onclick={() => kopiuj(p)} title="Kopiuj link" aria-label="Kopiuj link: {p.opis}" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><Copy size={15} /></button>
						{#if p.w_magazynie || p.ze_zrodla}
							<a href={p.adres} target="_blank" rel="noopener noreferrer" title="Otwórz" aria-label="Otwórz: {p.opis}" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><ExternalLink size={15} /></a>
						{/if}
						{#if mozeZmieniac}
							<label class="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-surface-2 cursor-pointer {wysylany === p.sciezka ? 'opacity-60 pointer-events-none' : ''}">
								<Upload size={14} /> {wysylany === p.sciezka ? 'Wysyłanie…' : p.w_magazynie ? 'Podmień' : 'Wgraj'}
								<input type="file" accept={p.typ === 'application/pdf' ? 'application/pdf,.pdf' : p.typ} onchange={(e) => podmien(p, e)} class="sr-only" />
							</label>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
