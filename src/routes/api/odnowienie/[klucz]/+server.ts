import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/auth';
import {
	BUCKET,
	czyAktywny,
	klientZadania,
	odnowieniePoKluczu,
	opObecnie,
	sumaObecna,
	usunSierotyPlikow,
	widok,
	zapiszZWersja,
	zapiszZdarzenie,
	type RenewalRow
} from '$lib/server/renewals';
import { poApk, poZlozeniu } from '$lib/server/renewalFlow';
import {
	APK_ODMOWA_TRESC,
	TYPY_ZALACZNIKOW,
	ZALACZNIKI_MAX,
	ZALACZNIK_MAX_BAJTOW,
	ZALACZNIK_TYPY_MIME,
	waliduj_ankiete,
	waliduj_apk,
	waliduj_wniosek,
	wycenaWniosku,
	type TypZalacznika
} from '$lib/renewals/program';
import type { OdpowiedzZalacznikUrl, OdpowiedzZloz } from '$lib/renewals/api';
import type { RequestHandler } from './$types';

// Strona klienta /odnowienie/[klucz]. Klient nie ma konta: jedynym uprawnieniem jest podpisany klucz
// z linku. Wszystko, co przychodzi, jest sprawdzane tymi samymi regułami co na stronie (program.ts).

const nieznany = () => json({ stan: 'nieznany' });

export const GET: RequestHandler = async ({ params, request, getClientAddress }) => {
	const admin = getAdminClient();
	const r = await odnowieniePoKluczu(admin, params.klucz);
	if (!r) return nieznany();

	// Pierwsze otwarcie: zapis czasu, IP i przeglądarki.
	if (czyAktywny(r) && !r.otwarto_at) {
		const teraz = new Date().toISOString();
		await admin
			.from('crm_renewals')
			.update({ otwarto_at: teraz, ...(r.status === 'utworzony' || r.status === 'wyslany' ? { status: 'otwarty' } : {}), updated_at: teraz })
			.eq('id', r.id)
			.in('status', ['utworzony', 'wyslany', 'otwarty', 'apk'])
			.is('otwarto_at', null);
		await zapiszZdarzenie(admin, r, 'otwarcie', klientZadania(request, getClientAddress));
		if (r.status === 'utworzony' || r.status === 'wyslany') r.status = 'otwarty';
	}
	return json(widok(r), { headers: { 'cache-control': 'no-store' } });
};

const blad = (status: number, message: string, bledy?: string[]) => json({ message, ...(bledy ? { bledy } : {}) }, { status });

// Praca po odpowiedzi (PDF, e-maile): na Cloudflare przez waitUntil, lokalnie — czekamy.
async function wTle(event: Parameters<RequestHandler>[0], praca: Promise<unknown>, opis: string) {
	const dalej = praca.catch((e) => console.error(`renewals: ${opis}:`, (e as Error)?.message ?? e));
	const ctx = (event.platform as { context?: { waitUntil(p: Promise<unknown>): void } } | undefined)?.context;
	if (ctx?.waitUntil) ctx.waitUntil(dalej);
	else await dalej;
}

export const POST: RequestHandler = async (event) => {
	const { params, request, getClientAddress } = event;
	const admin = getAdminClient();
	const r = await odnowieniePoKluczu(admin, params.klucz);
	if (!r) return blad(404, 'Ten link jest nieprawidłowy.');
	if (r.status === 'zlozony') return blad(409, 'Wniosek został już złożony.');
	if (!czyAktywny(r)) return blad(410, 'Ten link jest już nieaktywny.');

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object') return blad(400, 'Nieprawidłowe dane.');
	const kto = klientZadania(request, getClientAddress);

	switch (body.akcja) {
		case 'apk': {
			const w = waliduj_apk(body.apk);
			if (!w.ok) return blad(400, 'Uzupełnij analizę potrzeb.', w.bledy);
			const teraz = new Date().toISOString();
			const zapisany = await zapiszZWersja(admin, r, {
				apk: w.value,
				apk_odmowa: false,
				apk_at: teraz,
				...(r.status !== 'apk' ? { status: 'apk' } : {})
			});
			if (!zapisany) return blad(409, 'Wniosek zmienił się w międzyczasie — odśwież stronę.');
			await zapiszZdarzenie(admin, r, 'apk', kto);
			// PDF APK od razu do klienta (osobny dokument; wniosek przyjdzie drugim e-mailem).
			await wTle(event, poApk(event, admin, zapisany, kto, { aktualizacja: !!r.apk_at }), 'po APK');
			return json(widok(zapisany));
		}

		case 'apk_odmowa': {
			if (body.potwierdzenie !== true) return blad(400, 'Potwierdź odmowę wypełnienia APK.');
			const zapisany = await zapiszZWersja(admin, r, {
				apk: null,
				apk_odmowa: true,
				apk_at: new Date().toISOString(),
				...(r.status !== 'apk' ? { status: 'apk' } : {})
			});
			if (!zapisany) return blad(409, 'Wniosek zmienił się w międzyczasie — odśwież stronę.');
			await zapiszZdarzenie(admin, r, 'apk_odmowa', kto, { tresc: APK_ODMOWA_TRESC });
			await wTle(event, poApk(event, admin, zapisany, kto, { aktualizacja: !!r.apk_at }), 'po odmowie APK');
			return json(widok(zapisany));
		}

		case 'zalacznik_url': {
			const typ = body.typ as TypZalacznika;
			const nazwa = typeof body.nazwa === 'string' ? body.nazwa.trim().slice(0, 150) : '';
			const rozmiar = Number(body.rozmiar);
			const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : '';
			if (typeof typ !== 'string' || !Object.hasOwn(TYPY_ZALACZNIKOW, typ)) return blad(400, 'Nieprawidłowy rodzaj załącznika.');
			if (!nazwa) return blad(400, 'Brak nazwy pliku.');
			if (!Number.isFinite(rozmiar) || rozmiar <= 0 || rozmiar > ZALACZNIK_MAX_BAJTOW) return blad(400, 'Plik może mieć najwyżej 10 MB.');
			if (!ZALACZNIK_TYPY_MIME.includes(mime)) return blad(400, 'Dozwolone są pliki PDF i zdjęcia (JPG, PNG, WEBP, HEIC).');
			if ((r.zalaczniki ?? []).length >= ZALACZNIKI_MAX) return blad(400, `Można dodać najwyżej ${ZALACZNIKI_MAX} plików.`);

			const id = crypto.randomUUID();
			const bezpieczna = nazwa.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'plik';
			const path = `${r.tenant_id}/${r.id}/${id}-${bezpieczna}`;
			const { data: podpis, error: e } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
			if (e || !podpis) return blad(500, 'Nie udało się przygotować wysyłki pliku. Spróbuj ponownie.');

			const zalacznik = { id, path, typ, nazwa, rozmiar, mime, at: new Date().toISOString() };
			// Lista w jsonb: zapis z kontrolą wersji, z ponowieniem przy równoległym dodawaniu plików.
			let biezacy: RenewalRow | null = r;
			for (let proba = 0; proba < 4 && biezacy; proba++) {
				const zapisany = await zapiszZWersja(admin, biezacy, { zalaczniki: [...(biezacy.zalaczniki ?? []), zalacznik] });
				if (zapisany) {
					const odp: OdpowiedzZalacznikUrl = { id, path: podpis.path, token: podpis.token, zalacznik: { id, typ, nazwa, rozmiar, mime } };
					return json(odp);
				}
				const { data } = await admin.from('crm_renewals').select('*').eq('id', r.id).maybeSingle();
				biezacy = data as RenewalRow | null;
				if (biezacy && (biezacy.zalaczniki ?? []).length >= ZALACZNIKI_MAX) return blad(400, `Można dodać najwyżej ${ZALACZNIKI_MAX} plików.`);
			}
			return blad(409, 'Nie udało się zapisać pliku — spróbuj ponownie.');
		}

		case 'zalacznik_usun': {
			const id = typeof body.id === 'string' ? body.id : '';
			let biezacy: RenewalRow | null = r;
			for (let proba = 0; proba < 4 && biezacy; proba++) {
				const z = (biezacy.zalaczniki ?? []).find((x) => x.id === id);
				if (!z) return json(widok(biezacy));
				const zapisany = await zapiszZWersja(admin, biezacy, { zalaczniki: biezacy.zalaczniki.filter((x) => x.id !== id) });
				if (zapisany) {
					await admin.storage.from(BUCKET).remove([z.path]);
					return json(widok(zapisany));
				}
				const { data } = await admin.from('crm_renewals').select('*').eq('id', r.id).maybeSingle();
				biezacy = data as RenewalRow | null;
			}
			return blad(409, 'Nie udało się usunąć pliku — spróbuj ponownie.');
		}

		case 'zloz': {
			if (!r.apk_at) return blad(400, 'Najpierw wypełnij analizę potrzeb (APK) albo zaznacz odmowę jej wypełnienia.');
			const apk = r.apk_odmowa ? null : r.apk;
			const w = waliduj_wniosek(body.wniosek, apk);
			if (!w.ok) return blad(400, 'Popraw wniosek.', w.bledy);
			const wniosek = w.value;
			// Klauzula ochrony prawnej, którą certyfikat już ma, nie jest zmianą ani dopłatą.
			if (wniosek.zmiany && opObecnie(r)) wniosek.zmiany.ochrona_prawna = false;
			// Wyższa suma musi być wyższa od obecnej (strona pokazuje tylko takie, serwer sprawdza sam).
			const nowaSuma = wniosek.zmiany?.wyzsza_suma;
			const suma = sumaObecna(r);
			if (nowaSuma != null && suma != null && nowaSuma <= suma) {
				return blad(400, 'Popraw wniosek.', ['Nowa suma gwarancyjna musi być wyższa od obecnej.']);
			}

			// Pliki, które naprawdę są w magazynie (nieudane wysyłki odpadają).
			// Rozmiar bierzemy z magazynu, nie z deklaracji klienta.
			const { data: pliki } = await admin.storage.from(BUCKET).list(`${r.tenant_id}/${r.id}`, { limit: 1000 });
			const rozmiary = new Map((pliki ?? []).map((p) => [p.name, Number((p.metadata as { size?: number } | null)?.size ?? 0)]));
			const zalaczniki = (r.zalaczniki ?? [])
				.filter((z) => rozmiary.has(z.path.split('/').pop() ?? ''))
				.map((z) => ({ ...z, rozmiar: rozmiary.get(z.path.split('/').pop() ?? '') || z.rozmiar }));

			let ankieta = null;
			if (wniosek.zmiany?.zabiegi_ankieta.length) {
				const a = waliduj_ankiete(body.ankieta);
				const bledy = a.ok ? [] : [...a.bledy];
				if (!zalaczniki.some((z) => z.typ === 'dyplom')) bledy.push('Dołącz skan dyplomu (np. kosmetologia).');
				if (!zalaczniki.some((z) => z.typ === 'certyfikat')) bledy.push('Dołącz certyfikat ze szkolenia z zabiegu (ukończonego co najmniej 12 miesięcy przed początkiem ochrony).');
				if (bledy.length || !a.ok) return blad(400, 'Uzupełnij ankietę ERGO Hestii.', bledy);
				ankieta = a.value;
			}

			const wycena = wycenaWniosku(wniosek, apk, r.skladka != null ? Number(r.skladka) : null, opObecnie(r));
			const skladka_nowa =
				wniosek.decyzja === 'nie' ? null
				: wycena?.rodzaj === 'kwota' ? wycena.kwota
				: wycena?.rodzaj === 'indywidualna' ? null
				: r.skladka;

			// Zajęcie wniosku: drugie złożenie (podwójne kliknięcie, druga karta) dostaje 409.
			const teraz = new Date().toISOString();
			const { data: zlozony } = await admin
				.from('crm_renewals')
				.update({ status: 'zlozony', decyzja: wniosek.decyzja, wniosek, ankieta, zalaczniki, skladka_nowa, zlozono_at: teraz, updated_at: teraz })
				.eq('id', r.id)
				.in('status', ['utworzony', 'wyslany', 'otwarty', 'apk'])
				.gt('wazny_do', teraz)
				.select('*')
				.maybeSingle();
			if (!zlozony) return blad(409, 'Wniosek został już złożony albo link wygasł.');
			await zapiszZdarzenie(admin, r, 'zlozenie', kto, { decyzja: wniosek.decyzja });

			// PDF, e-maile i zadanie idą w tle (Cloudflare: waitUntil), żeby klient nie czekał na wysyłkę.
			await wTle(event, Promise.all([poZlozeniu(event, admin, zlozony as RenewalRow, kto), usunSierotyPlikow(admin, zlozony as RenewalRow)]), 'po złożeniu');
			const odp: OdpowiedzZloz = { ok: true, decyzja: wniosek.decyzja, skladka_nowa, wycena_indywidualna: wycena?.rodzaj === 'indywidualna' };
			return json(odp);
		}

		default:
			throw error(400, { message: 'Nieznane działanie.' });
	}
};
