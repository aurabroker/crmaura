<script lang="ts">
	import { AlertCircle, FileText, Trash2, Upload } from 'lucide-svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { sb } from '$lib/supabase';
	import type { OdpowiedzZalacznikUrl, Zalacznik } from '$lib/renewals/api';
	import {
		ZALACZNIKI_MAX,
		ZALACZNIKI_MAX_LACZNIE,
		ZALACZNIK_MAX_BAJTOW,
		ZALACZNIK_TYPY_MIME,
		type TypZalacznika
	} from '$lib/renewals/program';
	import Bledy from './Bledy.svelte';
	import { fmtRozmiar, mimePliku, wyslij } from './klient';
	import type { Odnowienie } from './stan.svelte';

	// Jedno miejsce na pliki: rodzaj dokumentu (+ osoba i zabieg dla dyplomu/certyfikatu).
	// Plik idzie prosto do magazynu przez jednorazowy podpisany adres od serwera
	// (zalacznik_url → uploadToSignedUrl). Limity sprawdza też serwer.
	interface Props {
		s: Odnowienie;
		typ: TypZalacznika;
		etykieta: string;
		osoba?: string | null;
		/** Imię i nazwisko osoby — zapisane przy pliku, żeby osobę dało się odtworzyć w nowej karcie. */
		osobaNazwa?: string;
		zabieg?: string | null;
		wymagany?: boolean;
		testid?: string;
	}
	let { s, typ, etykieta, osoba = null, osobaNazwa = '', zabieg = null, wymagany = false, testid = typ }: Props = $props();

	const ACCEPT = [...ZALACZNIK_TYPY_MIME, '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].join(',');

	let message = $state('');
	let bledy = $state<string[]>([]);
	let usuwane = $state<string[]>([]);

	const pasuje = (z: { typ: string; osoba?: string | null; zabieg?: string | null }) =>
		z.typ === typ && (z.osoba ?? null) === osoba && (z.zabieg ?? null) === zabieg;
	const pliki = $derived(s.zalaczniki.filter(pasuje));
	const wgrywane = $derived(s.wgrywane.filter(pasuje));

	// Limity na cały wniosek (wszystkie miejsca razem).
	const liczba = () => s.zalaczniki.length + s.wgrywane.filter((w) => w.stan === 'wysylanie').length;
	const bajty = () =>
		s.zalaczniki.reduce((a, z) => a + z.rozmiar, 0) + s.wgrywane.filter((w) => w.stan === 'wysylanie').reduce((a, w) => a + w.rozmiar, 0);
	const limit = $derived(liczba() >= ZALACZNIKI_MAX);

	function wybrano(e: Event & { currentTarget: HTMLInputElement }) {
		const wybrane = Array.from(e.currentTarget.files ?? []);
		// Czyścimy pole, żeby ten sam plik można było wybrać ponownie (np. po błędzie).
		e.currentTarget.value = '';
		message = '';
		const bl: string[] = [];
		for (const f of wybrane) {
			const mime = mimePliku(f);
			if (liczba() >= ZALACZNIKI_MAX) bl.push(`„${f.name}”: można dołączyć najwyżej ${ZALACZNIKI_MAX} plików do wniosku.`);
			else if (!ZALACZNIK_TYPY_MIME.includes(mime)) bl.push(`„${f.name}”: nieobsługiwany format. Dołącz PDF albo zdjęcie (JPG, PNG, WEBP, HEIC).`);
			else if (f.size > ZALACZNIK_MAX_BAJTOW) bl.push(`„${f.name}”: plik jest za duży (${fmtRozmiar(f.size)}). Maksymalnie ${fmtRozmiar(ZALACZNIK_MAX_BAJTOW)}.`);
			else if (f.size === 0) bl.push(`„${f.name}”: plik jest pusty.`);
			else if (bajty() + f.size > ZALACZNIKI_MAX_LACZNIE) bl.push(`„${f.name}”: przekroczony łączny limit ${fmtRozmiar(ZALACZNIKI_MAX_LACZNIE)} na wniosek. Zmniejsz zdjęcia albo usuń zbędne pliki.`);
			else wgraj(f, mime);
		}
		bledy = bl;
	}

	async function wgraj(f: File, mime: string) {
		const tmp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		// Wpis dodajemy od razu (przed pierwszym await) — limity liczą się poprawnie przy wyborze kilku naraz.
		s.wgrywane.push({ tmp, typ, osoba, zabieg, nazwa: f.name, rozmiar: f.size, stan: 'wysylanie', blad: '' });
		const blad = (msg: string) => {
			const w = s.wgrywane.find((x) => x.tmp === tmp);
			if (w) {
				w.stan = 'blad';
				w.blad = msg;
			}
		};

		const r = await wyslij<OdpowiedzZalacznikUrl>(s.klucz, { akcja: 'zalacznik_url', typ, osoba, ...(osoba ? { osoba_nazwa: osobaNazwa.trim() } : {}), zabieg, nazwa: f.name, rozmiar: f.size, mime });
		if (!r.ok) return blad([r.message, ...r.bledy].join(' '));

		// Typ pliku ustalony z rozszerzenia (np. HEIC bez typu) musi trafić do magazynu.
		const plik = f.type === mime ? f : new File([f], f.name, { type: mime });
		let nieudany = false;
		try {
			const { error } = await sb.storage.from('renewal-files').uploadToSignedUrl(r.data.path, r.data.token, plik, { contentType: mime });
			nieudany = !!error;
		} catch {
			nieudany = true;
		}
		if (nieudany) {
			// Wpis bez pliku usuwamy od razu, żeby nie udawał dołączonego dokumentu.
			void wyslij(s.klucz, { akcja: 'zalacznik_usun', id: r.data.id });
			return blad('Nie udało się wysłać pliku. Sprawdź połączenie i spróbuj ponownie.');
		}
		s.wgrywane = s.wgrywane.filter((x) => x.tmp !== tmp);
		s.zalaczniki.push(r.data.zalacznik);
	}

	async function usun(z: Zalacznik) {
		message = '';
		bledy = [];
		usuwane.push(z.id);
		const r = await wyslij(s.klucz, { akcja: 'zalacznik_usun', id: z.id });
		usuwane = usuwane.filter((x) => x !== z.id);
		if (!r.ok) {
			message = `Nie udało się usunąć pliku „${z.nazwa}”. ${r.message}`;
			bledy = r.bledy;
			return;
		}
		s.zalaczniki = s.zalaczniki.filter((x) => x.id !== z.id);
	}

	const odrzuc = (tmp: string) => (s.wgrywane = s.wgrywane.filter((x) => x.tmp !== tmp));
</script>

<div class="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="zal-{testid}">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<span class="font-medium text-slate-900 break-words">{etykieta}</span>
			{#if wymagany}
				{#if pliki.length}<Badge variant="success">dołączono</Badge>{:else}<Badge variant="warning">wymagany</Badge>{/if}
			{/if}
		</div>
		<label
			class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#2a3b69]
				hover:bg-slate-50 has-focus-visible:ring-2 has-focus-visible:ring-rose-500 {limit ? 'pointer-events-none opacity-50' : ''}"
		>
			<input type="file" class="sr-only" accept={ACCEPT} multiple disabled={limit} data-testid="plik-{testid}" onchange={wybrano} />
			<Upload size={16} aria-hidden="true" /> Dodaj plik<span class="sr-only">: {etykieta}</span>
		</label>
	</div>

	{#if pliki.length || wgrywane.length}
		<ul class="mt-2 space-y-2">
			{#each pliki as z (z.id)}
				<li class="flex items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
					<FileText size={18} class="shrink-0 text-slate-400" aria-hidden="true" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium text-slate-900">{z.nazwa}</span>
						<span class="block text-xs text-slate-500">{fmtRozmiar(z.rozmiar)}</span>
					</span>
					<button
						type="button"
						class="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50"
						aria-label="Usuń plik {z.nazwa}"
						disabled={usuwane.includes(z.id)}
						onclick={() => usun(z)}
					>
						<Trash2 size={17} aria-hidden="true" />
					</button>
				</li>
			{/each}
			{#each wgrywane as w (w.tmp)}
				<li class="rounded-lg bg-white px-3 py-2 ring-1 {w.stan === 'blad' ? 'ring-red-300' : 'ring-slate-200'}">
					<div class="flex items-center gap-3">
						{#if w.stan === 'blad'}
							<AlertCircle size={18} class="shrink-0 text-red-600" aria-hidden="true" />
						{:else}
							<FileText size={18} class="shrink-0 text-slate-400" aria-hidden="true" />
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium text-slate-900">{w.nazwa}</span>
							<span class="block text-xs {w.stan === 'blad' ? 'text-red-700' : 'text-slate-500'}" role="status">
								{w.stan === 'blad' ? w.blad : `Wysyłanie… (${fmtRozmiar(w.rozmiar)})`}
							</span>
						</span>
						{#if w.stan === 'blad'}
							<button
								type="button"
								class="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
								aria-label="Usuń z listy {w.nazwa}"
								onclick={() => odrzuc(w.tmp)}
							>
								<Trash2 size={17} aria-hidden="true" />
							</button>
						{/if}
					</div>
					{#if w.stan === 'wysylanie'}
						<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
							<div class="pasek h-full w-1/3 rounded-full bg-rose-500"></div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<Bledy {message} {bledy} />
</div>

<style>
	/* Pasek „w toku” — wysyłka przez supabase-js nie raportuje postępu w bajtach. */
	.pasek {
		animation: pasek 1.2s ease-in-out infinite;
	}
	@keyframes pasek {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pasek {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
	}
</style>
