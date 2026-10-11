/**
 * ZGŁOSZENIA BEAUTY POLISA — arkusz → BEAUTY (Aura HUB) + CRM
 *
 * Co 15 minut (wyzwalacz czasowy na funkcję eksportujOba):
 *  1. BEAUTY  — nowe wiersze trafiają do bazy BEAUTY (mailingi kampanii).        Status: kolumna S (19)
 *  2. CRM     — każde zgłoszenie trafia do CRM. Nowa firma od razu staje się
 *               klientem i leadem; ponowne zgłoszenie znanej firmy pokazuje
 *               agentowi komunikat „Klient po raz kolejny prosi o ofertę”
 *               i zakłada zadanie na dziś.                                     Status: kolumna T (20)
 * Kolumna R (GetResponse) nie jest już używana — zostaje w arkuszu jako historia.
 *
 * KLUCZE NIE SĄ W KODZIE. Ustaw je w: Rozszerzenia → Apps Script → Ustawienia projektu
 * → Właściwości skryptu:
 *   CRM_KLUCZ        — klucz z CRM: Ustawienia → System → „Formularz zgłoszeń” → Wygeneruj klucz
 *   LEAD_IMPORT_KEY  — klucz funkcji lead-import w BEAUTY (sekret LEAD_IMPORT_API_KEY w projekcie BEAUTY)
 *   CRM_ADRES        — (opcjonalnie) adres CRM; domyślnie https://crmaura.pages.dev/api/leady/zgloszenia
 *
 * PIERWSZE URUCHOMIENIE: wybierz funkcję startCRM i kliknij Uruchom (raz).
 * Wszystkie dotychczasowe wiersze trafią do CRM jako historia — bez komunikatów i zadań —
 * żeby CRM znał wcześniejsze zgłoszenia. Od tej chwili nowe wiersze idą normalnie.
 */

// ─── ARKUSZ ───────────────────────────────────────────────────────────────────
var NAZWA_ARKUSZA  = 'Zgloszenia_Polisa_FF_30';
var START_WIERSZ   = 2;       // wiersz 1 = nagłówki
var KOL_STATUS_GR  = 18;      // kolumna R — GetResponse (już nieużywana, tylko odczyt daty historycznych wierszy)
var KOL_STATUS_SUP = 19;      // kolumna S — BEAUTY
var KOL_STATUS_CRM = 20;      // kolumna T — CRM
var PACZKA_CRM     = 100;     // tyle wierszy w jednym wywołaniu CRM

var BEAUTY_URL = 'https://dhuvykwecsxgchzxufxw.supabase.co/functions/v1/lead-import';
var CRM_URL_DOMYSLNY = 'https://crmaura.pages.dev/api/leady/zgloszenia';

// ─── FUNKCJA GŁÓWNA — wyzwalacz co 15 minut ──────────────────────────────────
function eksportujOba() {
  eksportujDoSupabase();
  eksportujDoCRM();
}

// ─── PIERWSZE URUCHOMIENIE CRM (raz) ─────────────────────────────────────────
function startCRM() {
  var arkusz = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NAZWA_ARKUSZA);
  if (!arkusz) { Logger.log('CRM: nie znaleziono arkusza'); return; }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CRM_START')) props.setProperty('CRM_START', String(arkusz.getLastRow()));
  Logger.log('CRM: wiersze do ' + props.getProperty('CRM_START') + ' trafią do CRM jako historia.');
  eksportujDoCRM();
}

// ─── BEAUTY (Aura HUB) ───────────────────────────────────────────────────────
function eksportujDoSupabase() {
  var arkusz = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NAZWA_ARKUSZA);
  if (!arkusz) { Logger.log('SUP: nie znaleziono arkusza'); return; }
  var klucz = PropertiesService.getScriptProperties().getProperty('LEAD_IMPORT_KEY');
  if (!klucz) { Logger.log('SUP: brak właściwości LEAD_IMPORT_KEY — pomijam BEAUTY'); return; }

  var ostatniWiersz = arkusz.getLastRow();
  if (ostatniWiersz < START_WIERSZ) return;
  var liczbaWierszy = ostatniWiersz - START_WIERSZ + 1;
  var dane       = arkusz.getRange(START_WIERSZ, 1, liczbaWierszy, 8).getValues();
  var statusySUP = arkusz.getRange(START_WIERSZ, KOL_STATUS_SUP, liczbaWierszy, 1).getValues();
  var ok = 0, pominiete = 0, bledy = 0;

  for (var i = 0; i < dane.length; i++) {
    if (String(statusySUP[i][0] || '').trim() !== '') { pominiete++; continue; }
    var w = wiersz(dane[i]);
    if (!w.company) { pominiete++; continue; }
    try {
      var response = UrlFetchApp.fetch(BEAUTY_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-api-key': klucz },
        payload: JSON.stringify({
          company: w.company, contact: w.contact, email: w.email, phone: w.phone,
          nip: w.nip, ubezpieczenie: w.ubezpieczenie, przychod: w.przychod
        }),
        muteHttpExceptions: true
      });
      var kod = response.getResponseCode();
      var res = kod === 200 ? JSON.parse(response.getContentText()) : null;
      if (res && res.success) {
        var status = res.details && res.details[0] ? res.details[0].status : 'ok';
        arkusz.getRange(START_WIERSZ + i, KOL_STATUS_SUP).setValue((status === 'merged' ? 'Duplikat NIP ' : 'Supabase OK ') + teraz());
        ok++;
      } else {
        Logger.log('SUP BŁĄD ' + (START_WIERSZ + i) + ' [' + kod + ']: ' + response.getContentText().slice(0, 200));
        bledy++;
      }
      Utilities.sleep(200);
    } catch (e) {
      Logger.log('SUP WYJĄTEK ' + (START_WIERSZ + i) + ': ' + e.message);
      bledy++;
    }
  }
  Logger.log('══ BEAUTY: OK=' + ok + ' | Pominięto=' + pominiete + ' | Błędy=' + bledy);
}

// ─── CRM ─────────────────────────────────────────────────────────────────────
function eksportujDoCRM() {
  var arkusz = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NAZWA_ARKUSZA);
  if (!arkusz) { Logger.log('CRM: nie znaleziono arkusza'); return; }
  var props = PropertiesService.getScriptProperties();
  var klucz = props.getProperty('CRM_KLUCZ');
  if (!klucz) { Logger.log('CRM: brak właściwości CRM_KLUCZ — pomijam CRM'); return; }
  var start = Number(props.getProperty('CRM_START') || 0);
  if (!start) { Logger.log('CRM: najpierw uruchom raz funkcję startCRM'); return; }
  var adres = props.getProperty('CRM_ADRES') || CRM_URL_DOMYSLNY;

  var ostatniWiersz = arkusz.getLastRow();
  if (ostatniWiersz < START_WIERSZ) return;
  var liczbaWierszy = ostatniWiersz - START_WIERSZ + 1;
  var dane       = arkusz.getRange(START_WIERSZ, 1, liczbaWierszy, 8).getValues();
  var statusyGR  = arkusz.getRange(START_WIERSZ, KOL_STATUS_GR, liczbaWierszy, 1).getValues();
  var statusySUP = arkusz.getRange(START_WIERSZ, KOL_STATUS_SUP, liczbaWierszy, 1).getValues();
  var statusyCRM = arkusz.getRange(START_WIERSZ, KOL_STATUS_CRM, liczbaWierszy, 1).getValues();

  // Wiersze jeszcze niewysłane do CRM.
  var kolejka = [];
  for (var i = 0; i < dane.length; i++) {
    if (String(statusyCRM[i][0] || '').trim() !== '') continue;
    var w = wiersz(dane[i]);
    if (!w.company && !w.email && !w.nip) continue;
    var nr = START_WIERSZ + i;
    var historyczny = nr <= start;
    w.ref = NAZWA_ARKUSZA + '!' + nr + '|' + w.nip + '|' + w.email;
    w.historyczne = historyczny;
    // Data historycznego wiersza z kolumny S albo R („Supabase OK 12.05.2026 10:15”); nowe wiersze — teraz.
    w.data = historyczny ? (dataZeStatusu(statusySUP[i][0]) || dataZeStatusu(statusyGR[i][0]) || '') : new Date().toISOString();
    kolejka.push({ nr: nr, w: w });
  }
  if (!kolejka.length) return;

  var wyslane = 0;
  for (var p = 0; p < kolejka.length; p += PACZKA_CRM) {
    var paczka = kolejka.slice(p, p + PACZKA_CRM);
    var response;
    try {
      response = UrlFetchApp.fetch(adres, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-api-key': klucz },
        payload: JSON.stringify(paczka.map(function (x) { return x.w; })),
        muteHttpExceptions: true
      });
    } catch (e) {
      Logger.log('CRM WYJĄTEK: ' + e.message + ' — spróbuję przy następnym uruchomieniu');
      return;
    }
    var kod = response.getResponseCode();
    if (kod === 401) { Logger.log('CRM: zły klucz CRM_KLUCZ — wygeneruj nowy w CRM i wklej do właściwości skryptu'); return; }
    if (kod !== 200) { Logger.log('CRM BŁĄD [' + kod + ']: ' + response.getContentText().slice(0, 300)); return; }
    var res = JSON.parse(response.getContentText());
    var czas = teraz();
    var opis = { nowe: 'nowy klient', ponowne: 'PONOWNE', historyczne: 'historia', duplikat: 'już był', pominiete: 'pominięty' };
    for (var j = 0; j < paczka.length; j++) {
      var wynik = res.wyniki && res.wyniki[j] ? res.wyniki[j].status : 'ok';
      arkusz.getRange(paczka[j].nr, KOL_STATUS_CRM).setValue('CRM ' + (opis[wynik] || wynik) + ' ' + czas);
    }
    wyslane += paczka.length;
    Logger.log('CRM: nowe=' + res.nowe + ' ponowne=' + res.ponowne + ' historia=' + res.historyczne + ' duplikaty=' + res.duplikaty);
  }
  Logger.log('══ CRM: wysłano ' + wyslane + ' wierszy');
}

// ─── POMOCNICZE ──────────────────────────────────────────────────────────────
function wiersz(r) {
  var imie = r[0] ? String(r[0]).trim() : '';
  var nazwisko = r[1] ? String(r[1]).trim() : '';
  return {
    company: r[2] ? String(r[2]).trim() : '',
    contact: (imie + ' ' + nazwisko).trim(),
    nip: r[3] ? String(r[3]).trim() : '',
    email: poprawEmail(r[4] ? String(r[4]).trim().toLowerCase() : ''),
    phone: formatujTelefon(r[5] ? String(r[5]).trim() : ''),
    ubezpieczenie: r[6] ? String(r[6]).trim() : '',
    przychod: r[7] ? String(r[7]).trim() : ''
  };
}

function teraz() {
  return Utilities.formatDate(new Date(), 'GMT+1', 'dd.MM.yyyy HH:mm');
}

// „Supabase OK 12.05.2026 10:15” → „2026-05-12T10:15:00+01:00” (statusy zapisywane w GMT+1).
function dataZeStatusu(tekst) {
  var m = String(tekst || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] + 'T' + m[4] + ':' + m[5] + ':00+01:00' : '';
}

function poprawEmail(raw) {
  if (!raw) return '';
  return raw
    .replace('gamil.com',  'gmail.com')
    .replace('gmaul.com',  'gmail.com')
    .replace('gnail.com',  'gmail.com')
    .replace('gmai.com',   'gmail.com')
    .replace('gmail.pl',   'gmail.com')
    .replace('wp.pll',     'wp.pl')
    .replace('vp.pl',      'wp.pl')
    .replace('.pl.',       '.pl')
    .replace(/\s+/g,       '');
}

function formatujTelefon(raw) {
  var t = raw.replace(/\D/g, '');
  if (!t) return '';
  if (t.length === 9)                          return '+48' + t;
  if (t.startsWith('48') && t.length === 11)   return '+' + t;
  return '+' + t;
}
