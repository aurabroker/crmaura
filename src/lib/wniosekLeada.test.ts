import test from 'node:test';
import assert from 'node:assert/strict';
import { dzienKrotko, grupaWniosku, krokiWniosku, ostatnieWnioskiKlientow, stanWniosku, type WniosekLeada } from './wniosekLeada.ts';

const TERAZ = '2026-11-22T10:00:00.000Z';
const baza: WniosekLeada = {
	id: 'w1', klient_id: 'k1', rodzaj: 'nowa', status: 'utworzony', decyzja: null, email: 'klient@example.com',
	wyslano_at: null, otwarto_at: null, apk_at: null, apk_odmowa: false, zlozono_at: null, przypomniano_at: null,
	wazny_do: '2026-12-10T22:59:59Z', created_at: '2026-11-10T08:00:00Z'
};

test('link utworzony bez wysyłki — „nie wysłano”; SMS z CRM robi z niego wysłany', () => {
	const st = stanWniosku(baza, [], TERAZ);
	assert.equal(st.klucz, 'link');
	assert.equal(st.wyslany, false);
	assert.equal(grupaWniosku(st), 'nie_wyslano');
	const zSms = stanWniosku(baza, [{ renewal_id: 'w1', at: '2026-11-12T09:00:00Z', numer: '+48600111222' }, { renewal_id: 'inny', at: '2026-11-01T09:00:00Z', numer: null }], TERAZ);
	assert.equal(zSms.klucz, 'wyslany');
	assert.equal(zSms.chip, 'Wysłany 12 lis');
	assert.equal(zSms.wyslanoAt, '2026-11-12T09:00:00Z');
	assert.equal(grupaWniosku(zSms), 'czeka');
});

test('e-mail, otwarcie, APK i złożenie — chip z dniem, grupy filtra', () => {
	const wyslany = { ...baza, status: 'wyslany' as const, wyslano_at: '2026-11-17T09:05:00Z' };
	assert.equal(stanWniosku(wyslany, [], TERAZ).chip, 'Wysłany 17 lis');
	const otwarty = { ...wyslany, status: 'otwarty' as const, otwarto_at: '2026-11-18T11:00:00Z' };
	assert.equal(stanWniosku(otwarty, [], TERAZ).chip, 'Otwarty 18 lis');
	const apk = { ...otwarty, status: 'apk' as const, apk_at: '2026-11-18T11:20:00Z' };
	assert.equal(stanWniosku(apk, [], TERAZ).etykieta, 'Klient wypełnił APK, wniosek w toku');
	const zlozony = { ...apk, status: 'zlozony' as const, decyzja: 'nowa' as const, zlozono_at: '2026-11-20T15:00:00Z' };
	const st = stanWniosku(zlozony, [], TERAZ);
	assert.deepEqual([st.klucz, st.chip, st.zakonczony, st.aktywny, grupaWniosku(st)], ['zlozony', 'Złożony 20 lis', true, false, 'zlozony']);
	const nie = stanWniosku({ ...zlozony, decyzja: 'nie' as const }, [], TERAZ);
	assert.equal(nie.klucz, 'rezygnacja');
	assert.deepEqual(krokiWniosku({ ...zlozony, decyzja: 'nie' as const }).map((k) => k.etykieta), ['Wysłano', 'Otwarto', 'APK', 'Rezygnacja']);
});

test('link po terminie i anulowany', () => {
	const poTerminie = stanWniosku({ ...baza, status: 'wyslany', wyslano_at: '2026-10-01T09:00:00Z', wazny_do: '2026-10-31T22:59:59Z' }, [], TERAZ);
	assert.deepEqual([poTerminie.klucz, poTerminie.aktywny, poTerminie.wyslany, grupaWniosku(poTerminie)], ['wygasl', false, true, 'wygasl']);
	const anulowany = stanWniosku({ ...baza, status: 'anulowany' }, [], TERAZ);
	assert.equal(grupaWniosku(anulowany), 'nie_wyslano');
	assert.equal(grupaWniosku(null), 'nie_wyslano');
});

test('najnowszy wniosek o pierwszą polisę na klienta, bez odnowień', () => {
	const m = ostatnieWnioskiKlientow([
		{ ...baza, id: 'stary', created_at: '2026-10-01T00:00:00Z' },
		{ ...baza, id: 'nowy', created_at: '2026-11-15T00:00:00Z' },
		{ ...baza, id: 'odnowienie', rodzaj: 'odnowienie', created_at: '2026-11-20T00:00:00Z' }
	]);
	assert.equal(m.get('k1')?.id, 'nowy');
	assert.equal(m.size, 1);
});

test('dzień w polskiej strefie czasowej', () => {
	assert.equal(dzienKrotko('2026-11-17T23:30:00Z'), '18 lis');
	assert.equal(dzienKrotko('2026-07-31T21:59:00Z'), '31 lip');
	assert.equal(dzienKrotko('2026-07-31T22:01:00Z'), '1 sie');
	assert.equal(dzienKrotko('2026-03-05'), '5 mar');
	assert.equal(dzienKrotko(null), '');
});
