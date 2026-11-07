<script lang="ts">
	// Link do wniosku dla klienta: krótki link (do SMS-a) z kopiowaniem, gotowa treść SMS-a i „Wyślij SMS”
	// (otwiera aplikację SMS z numerem klienta — na telefonie albo w komputerze z połączonym telefonem).
	// Pełny link z podpisem zostaje pod spodem, gdyby krótkiego nie udało się nadać.
	import { Copy, Link2, MessageSquare } from 'lucide-svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { hrefSms, liczbaSms, numerSms, trescSms } from '$lib/renewals/sms';

	interface Props {
		link: string;
		krotki?: string | null;
		waznyDo?: string | null;
		/** Telefon klienta z kartoteki (albo leada); bez niego nie ma przycisku „Wyślij SMS”. */
		telefon?: string | null;
		/** Pierwsza polisa (APK i wniosek) albo odnowienie certyfikatu — inna treść SMS-a. */
		nowa?: boolean;
		/** Pracownik otworzył SMS z linkiem (np. notatka w historii leada). */
		onsms?: (numer: string) => void;
		onzamknij: () => void;
	}
	let { link, krotki = null, waznyDo = null, telefon = null, nowa = false, onsms, onzamknij }: Props = $props();

	const pokazany = $derived(krotki || link);
	const sms = $derived(trescSms(pokazany, { nowa, waznyDo }));
	const numer = $derived(numerSms(telefon));
	const przycisk = 'h-7 flex items-center gap-1.5 px-2.5 border border-blue-300 rounded-lg bg-white text-xs font-medium text-blue-800 hover:bg-blue-50';

	async function kopiuj(tekst: string, opis: string) {
		try {
			await navigator.clipboard.writeText(tekst);
			ctxToast(`Skopiowano ${opis}`);
		} catch {
			ctxToast('Nie udało się skopiować — zaznacz tekst i skopiuj ręcznie');
		}
	}
</script>

<div class="mt-3 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5" data-testid="link-dla-klienta">
	<div class="flex items-center gap-2">
		<Link2 size={14} class="text-blue-600 shrink-0" />
		<span class="text-xs font-semibold text-blue-700 uppercase tracking-wide">{krotki ? 'Krótki link dla klienta' : 'Link dla klienta'}</span>
		<button type="button" onclick={onzamknij} class="ml-auto text-blue-400 hover:text-blue-700" aria-label="Ukryj link">✕</button>
	</div>
	<div class="mt-1.5 flex flex-wrap items-center gap-2">
		<input
			readonly
			value={pokazany}
			onfocus={(e) => e.currentTarget.select()}
			class="flex-1 min-w-[200px] border border-blue-200 bg-white rounded-md px-2 py-1 text-xs font-mono text-slate-700"
			data-testid="renewal-link"
		/>
		<button type="button" onclick={() => kopiuj(pokazany, 'link')} class={przycisk}><Copy size={12} /> Kopiuj link</button>
	</div>
	<div class="mt-2 flex flex-wrap items-start gap-2">
		<MessageSquare size={14} class="text-blue-600 shrink-0 mt-1" />
		<p class="flex-1 min-w-[220px] text-xs text-slate-700 bg-white border border-blue-100 rounded-md px-2 py-1.5 break-words" data-testid="tresc-sms">
			{sms}
			<span class="block mt-0.5 text-[11px] text-slate-400">{sms.length} znaków · {liczbaSms(sms) === 1 ? '1 SMS' : `${liczbaSms(sms)} SMS-y`}</span>
		</p>
		<div class="flex flex-wrap gap-2">
			<button type="button" onclick={() => kopiuj(sms, 'treść SMS-a')} class={przycisk}><Copy size={12} /> Kopiuj SMS</button>
			{#if numer}
				<a href={hrefSms(numer, sms)} onclick={() => onsms?.(numer)} class={przycisk} data-testid="wyslij-sms">
					<MessageSquare size={12} /> Wyślij SMS na {numer}
				</a>
			{:else}
				<span class="text-[11px] text-slate-500 self-center">Brak telefonu klienta — skopiuj treść SMS-a.</span>
			{/if}
		</div>
	</div>
	{#if krotki}
		<details class="mt-1.5 text-[11px] text-slate-500">
			<summary class="cursor-pointer select-none">Pełny link</summary>
			<span class="block mt-1 font-mono break-all">{link}</span>
		</details>
	{/if}
</div>
