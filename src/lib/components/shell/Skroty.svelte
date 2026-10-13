<script lang="ts">
	// Skróty klawiszowe CRM (jak w Gmailu): „g” + litera — przejdź, „n” + litera — nowe, „?” — lista skrótów.
	// Pojedyncze litery uruchamiają akcje bieżącego ekranu: element z data-skrot="e" (i data-skrot-opis)
	// zostanie kliknięty po naciśnięciu „e”. Skróty nie działają podczas pisania w polu ani przy otwartym oknie.
	// Komponent stoi w górnym pasku: przycisk z klawiaturą otwiera listę skrótów.
	import { goto } from '$app/navigation';
	import Modal from '$lib/components/Modal.svelte';
	import { appState, isBroker, isFinance } from '$lib/stores/app.svelte';
	import { Keyboard } from 'lucide-svelte';

	type Skrot = { klawisze: string; opis: string; href: string; widoczny?: boolean };
	let pomoc = $state(false);

	const przejdz = $derived<Skrot[]>([
		{ klawisze: 'g d', opis: 'Pulpit', href: '/dashboard' },
		{ klawisze: 'g c', opis: 'Kalendarz', href: '/calendar', widoczny: !!appState.tenantFeatures['kalendarz'] },
		{ klawisze: 'g k', opis: 'Klienci', href: '/clients' },
		{ klawisze: 'g p', opis: 'Polisy', href: '/policies' },
		{ klawisze: 'g u', opis: 'Umowy generalne', href: '/policies?typ=generalna' },
		{ klawisze: 'g o', opis: 'Odnowienia', href: '/renewals' },
		{ klawisze: 'g v', opis: 'Pojazdy', href: '/vehicles' },
		{ klawisze: 'g a', opis: 'APK', href: '/apk' },
		{ klawisze: 'g s', opis: 'Szkody', href: '/claims', widoczny: isBroker() },
		{ klawisze: 'g t', opis: 'Płatności', href: '/payments' },
		{ klawisze: 'g w', opis: 'Prowizja', href: '/commission' },
		{ klawisze: 'g f', opis: 'Rozliczenia', href: '/finance', widoczny: isFinance(appState.profile) },
		{ klawisze: 'g l', opis: 'Leady', href: '/prospects' },
		{ klawisze: 'g x', opis: 'Statystyki', href: '/statystyki' },
		{ klawisze: 'g r', opis: 'Raporty', href: '/raporty' },
		{ klawisze: 'g ,', opis: 'Ustawienia', href: '/settings' }
	]);
	const nowe = $derived<Skrot[]>([
		{ klawisze: 'n p', opis: 'Nowa polisa / UG', href: '/policies/new' },
		{ klawisze: 'n i', opis: 'Import polisy z PDF', href: '/policies/import' },
		{ klawisze: 'n k', opis: 'Nowy klient', href: '/clients?new=1' },
		{ klawisze: 'n s', opis: 'Zgłoś szkodę', href: '/claims?new=1', widoczny: isBroker() },
		{ klawisze: 'n v', opis: 'Dodaj pojazd', href: '/vehicles/new' }
	]);
	const sekwencje = $derived(new Map([...przejdz, ...nowe].filter((s) => s.widoczny !== false).map((s) => [s.klawisze, s.href])));

	let przedrostek: string | null = null;
	let zegar: ReturnType<typeof setTimeout> | undefined;
	let naEkranie = $state<{ klawisz: string; opis: string }[]>([]);

	const pisze = (t: EventTarget | null) => {
		const el = t as HTMLElement | null;
		return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
	};
	const widocznyElement = (el: HTMLElement) =>
		el.offsetParent !== null && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';

	function akcjeEkranu(): { klawisz: string; opis: string }[] {
		const lista = [...document.querySelectorAll<HTMLElement>('[data-skrot]')].filter(widocznyElement);
		const wynik = new Map<string, string>();
		for (const el of lista) {
			const k = el.dataset.skrot!;
			if (!wynik.has(k)) wynik.set(k, el.dataset.skrotOpis ?? el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '');
		}
		return [...wynik].map(([klawisz, opis]) => ({ klawisz, opis }));
	}

	function otworzPomoc() {
		naEkranie = akcjeEkranu();
		pomoc = true;
	}

	function klawisz(e: KeyboardEvent) {
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
		if (pisze(e.target)) return;
		if (e.key === '?') {
			e.preventDefault();
			if (pomoc) pomoc = false;
			else otworzPomoc();
			return;
		}
		// Przy otwartym oknie (formularz, potwierdzenie, lista skrótów) skróty ekranu nie działają
		if (document.querySelector('[role="dialog"]')) return;
		const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

		if (przedrostek) {
			const sekw = `${przedrostek} ${k}`;
			przedrostek = null;
			clearTimeout(zegar);
			const href = sekwencje.get(sekw);
			if (href) {
				e.preventDefault();
				goto(href);
			}
			return;
		}
		if ((k === 'g' || k === 'n') && !e.shiftKey) {
			przedrostek = k;
			clearTimeout(zegar);
			zegar = setTimeout(() => (przedrostek = null), 1500);
			return;
		}
		const cel = [...document.querySelectorAll<HTMLElement>(`[data-skrot="${CSS.escape(k)}"]`)].find(widocznyElement);
		if (cel) {
			e.preventDefault();
			cel.focus({ preventScroll: true });
			cel.click();
		}
	}
</script>

<svelte:window onkeydown={klawisz} />

<button
	onclick={otworzPomoc}
	class="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2"
	title="Skróty klawiszowe (?)"
	aria-label="Skróty klawiszowe"
>
	<Keyboard size={16} />
</button>

{#snippet klawisze(tekst: string)}
	<span class="flex items-center gap-1 shrink-0">
		{#each tekst.split(' ') as k, i}
			{#if i > 0}<span class="text-xs text-ink-3">potem</span>{/if}
			<kbd class="min-w-[22px] px-1.5 text-center font-mono text-xs leading-[20px] text-ink bg-surface-2 border border-line rounded">{k}</kbd>
		{/each}
	</span>
{/snippet}

<Modal title="Skróty klawiszowe" open={pomoc} onclose={() => { pomoc = false; naEkranie = []; }}>
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 text-sm">
		<section>
			<h3 class="text-[13px] font-semibold text-ink mb-2">Wszędzie</h3>
			<ul class="flex flex-col gap-1.5">
				<li class="flex items-center justify-between gap-3"><span class="text-ink-2">Szukaj klienta, polisy, NIP…</span><span class="flex items-center gap-1">{@render klawisze('Ctrl K')}<span class="text-xs text-ink-3">lub</span>{@render klawisze('/')}</span></li>
				<li class="flex items-center justify-between gap-3"><span class="text-ink-2">Ta lista skrótów</span>{@render klawisze('?')}</li>
				<li class="flex items-center justify-between gap-3"><span class="text-ink-2">Zamknij okno</span>{@render klawisze('Esc')}</li>
			</ul>
			<h3 class="text-[13px] font-semibold text-ink mt-5 mb-2">Nowe</h3>
			<ul class="flex flex-col gap-1.5">
				{#each nowe.filter((s) => s.widoczny !== false) as s}
					<li class="flex items-center justify-between gap-3"><span class="text-ink-2">{s.opis}</span>{@render klawisze(s.klawisze)}</li>
				{/each}
			</ul>
			{#if naEkranie.length}
				<h3 class="text-[13px] font-semibold text-ink mt-5 mb-2">Na tym ekranie</h3>
				<ul class="flex flex-col gap-1.5">
					{#each naEkranie as a}
						<li class="flex items-center justify-between gap-3"><span class="text-ink-2">{a.opis}</span>{@render klawisze(a.klawisz)}</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section>
			<h3 class="text-[13px] font-semibold text-ink mb-2">Przejdź do</h3>
			<ul class="flex flex-col gap-1.5">
				{#each przejdz.filter((s) => s.widoczny !== false) as s}
					<li class="flex items-center justify-between gap-3"><span class="text-ink-2">{s.opis}</span>{@render klawisze(s.klawisze)}</li>
				{/each}
			</ul>
		</section>
	</div>
	<p class="mt-5 text-xs text-ink-3">Skróty nie działają podczas pisania w polu tekstowym. Klawisze naciskaj po kolei, np. najpierw „g”, potem „p”.</p>
</Modal>
