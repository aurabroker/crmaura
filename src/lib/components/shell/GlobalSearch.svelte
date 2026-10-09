<script lang="ts">
	// Wyszukiwarka w górnym pasku — na każdym ekranie, skrót Ctrl+K (⌘K).
	// Szuka po nazwie klienta, NIP, PESEL, REGON, numerze polisy i rejestracji pojazdu.
	import { goto } from '$app/navigation';
	import { appState } from '$lib/stores/app.svelte';
	import { Search } from 'lucide-svelte';

	type Wynik = { grupa: string; tytul: string; opis: string; mono: boolean; href: string };

	let q = $state('');
	let otwarte = $state(false);
	let aktywny = $state(0);
	let pole: HTMLInputElement | undefined = $state();

	const bezSpacji = (s: string | null | undefined) => (s ?? '').replace(/[\s-]/g, '').toLowerCase();
	const cyfry = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

	const wyniki = $derived.by((): Wynik[] => {
		const fraza = q.trim().toLowerCase();
		if (fraza.length < 2) return [];
		const zwarta = bezSpacji(fraza);
		const fCyfry = cyfry(fraza);
		const poCyfrach = fCyfry.length >= 3 && fCyfry.length === zwarta.length;

		const klienci = appState.clients
			.filter((c) =>
				`${c.nazwa} ${c.nazwa_skrocona ?? ''} ${c.email ?? ''}`.toLowerCase().includes(fraza) ||
				(poCyfrach && [c.nip, c.pesel, c.regon, c.telefon].some((v) => cyfry(v).includes(fCyfry)))
			)
			.slice(0, 5)
			.map((c): Wynik => ({
				grupa: 'Klienci',
				tytul: c.nazwa_skrocona ?? c.nazwa,
				opis: c.nip ? `NIP ${c.nip}` : c.pesel ? `PESEL ${c.pesel}` : '',
				mono: false,
				href: `/clients/${c.id}`
			}));

		const polisy = appState.policies
			.filter((p) => bezSpacji(p.nr_polisy).includes(zwarta) || (p.crm_clients?.nazwa ?? '').toLowerCase().includes(fraza))
			.slice(0, 5)
			.map((p): Wynik => ({
				grupa: 'Polisy',
				tytul: p.nr_polisy,
				opis: [p.crm_clients?.nazwa, p.crm_insurers?.skrot ?? p.crm_insurers?.nazwa].filter(Boolean).join(' · '),
				mono: true,
				href: `/policies/${p.id}`
			}));

		const pojazdy = zwarta.length >= 3
			? appState.vehicles
				.filter((v) => bezSpacji(v.nr_rejestracyjny).includes(zwarta) || bezSpacji(v.vin).includes(zwarta))
				.slice(0, 4)
				.map((v): Wynik => ({
					grupa: 'Pojazdy',
					tytul: v.nr_rejestracyjny ?? v.vin ?? '—',
					opis: [v.marka_model, appState.clients.find((c) => c.id === v.klient_id)?.nazwa].filter(Boolean).join(' · '),
					mono: true,
					href: `/clients/${v.klient_id}`
				}))
			: [];

		return [...klienci, ...polisy, ...pojazdy];
	});

	$effect(() => {
		// Nowa fraza — podświetlenie wraca na pierwszy wynik
		void q;
		aktywny = 0;
	});

	function otworz(w: Wynik) {
		otwarte = false;
		q = '';
		pole?.blur();
		goto(w.href);
	}

	function klawisz(e: KeyboardEvent) {
		if (e.key === 'Escape') { otwarte = false; pole?.blur(); return; }
		if (!wyniki.length) return;
		if (e.key === 'ArrowDown') { e.preventDefault(); otwarte = true; aktywny = (aktywny + 1) % wyniki.length; }
		else if (e.key === 'ArrowUp') { e.preventDefault(); aktywny = (aktywny - 1 + wyniki.length) % wyniki.length; }
		else if (e.key === 'Enter') { e.preventDefault(); otworz(wyniki[aktywny]); }
	}

	function skrot(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			pole?.focus();
			pole?.select();
			otwarte = true;
		}
	}
</script>

<svelte:window onkeydown={skrot} />

<div class="relative flex-1 min-w-0 max-w-xl">
	<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
	<input
		bind:this={pole}
		bind:value={q}
		oninput={() => (otwarte = true)}
		onfocus={() => (otwarte = true)}
		onblur={() => setTimeout(() => (otwarte = false), 150)}
		onkeydown={klawisz}
		type="search"
		role="combobox"
		aria-expanded={otwarte && wyniki.length > 0}
		aria-controls="wyniki-szukaj"
		aria-activedescendant={otwarte && wyniki.length ? `wynik-${aktywny}` : undefined}
		aria-label="Szukaj klienta, polisy, NIP, PESEL lub rejestracji"
		placeholder="Szukaj klienta, polisy, NIP, PESEL, rejestracji…"
		class="w-full h-9 pl-9 {q ? 'pr-3' : 'pr-3 sm:pr-16'} bg-white border border-line rounded-lg text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
	/>
	<kbd class="{q ? 'hidden' : 'hidden sm:block'} absolute right-2 top-1/2 -translate-y-1/2 px-1.5 font-mono text-xs leading-[18px] text-ink-3 bg-surface-2 border border-line rounded pointer-events-none">Ctrl K</kbd>

	{#if otwarte && q.trim().length >= 2}
		<div class="absolute left-0 right-0 top-full mt-1 bg-white border border-line rounded-xl shadow-xl z-50 overflow-hidden">
			{#if wyniki.length === 0}
				<p class="px-4 py-3 text-sm text-ink-3">Nic nie znaleziono dla „{q.trim()}”.</p>
			{:else}
				<ul id="wyniki-szukaj" role="listbox" aria-label="Wyniki wyszukiwania" class="max-h-[420px] overflow-y-auto py-1">
					{#each wyniki as w, i}
						{#if i === 0 || wyniki[i - 1].grupa !== w.grupa}
							<li role="presentation" class="px-4 pt-2 pb-1 text-xs font-semibold text-ink-3 {i > 0 ? 'border-t border-line-soft mt-1' : ''}">{w.grupa}</li>
						{/if}
						<li
							id="wynik-{i}"
							role="option"
							aria-selected={i === aktywny}
							onmousedown={(e) => { e.preventDefault(); otworz(w); }}
							onmouseenter={() => (aktywny = i)}
							class="mx-1 px-3 py-2 rounded-lg flex items-baseline gap-2 cursor-pointer {i === aktywny ? 'bg-accent-soft' : ''}"
						>
							<span class="text-sm font-medium text-ink truncate {w.mono ? 'font-mono' : ''}">{w.tytul}</span>
							{#if w.opis}<span class="text-xs text-ink-3 truncate">{w.opis}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
