# Logowanie do API REGON (GUS BIR 1.1)

Dokumentacja procesu logowania i wyszukiwania firm w rejestrze REGON za pomocą
usługi **GUS BIR 1.1** (BIR1 — Baza Internetowa REGON). Przeznaczona dla innych
projektów, które chcą dopisać integrację z REGON na podstawie implementacji
użytej w tym CRM.

Implementacja referencyjna: [`src/routes/api/regon/lookup/+server.ts`](../src/routes/api/regon/lookup/+server.ts).

---

## 1. Założenia ogólne

API GUS BIR to usługa **SOAP 1.2 (WS-Addressing)** wystawiona pod jednym
endpointem. Komunikacja przebiega w trzech krokach:

1. **`Zaloguj`** — logujesz się kluczem API (`pKluczUzytkownika`) i otrzymujesz
   identyfikator sesji (`sid`).
2. **`DaneSzukajPodmioty`** — wyszukujesz podmiot po NIP / REGON / KRS,
   przekazując `sid` w nagłówku HTTP.
3. *(opcjonalnie)* **`Wyloguj`** — kończysz sesję.

> Sesja (`sid`) jest ważna przez ok. **60 minut bezczynności**. Można ją
> wielokrotnie używać, ale w tym CRM logowanie wykonujemy przy każdym
> zapytaniu dla prostoty.

### Endpointy i klucze

| Środowisko | Endpoint | Klucz |
| --- | --- | --- |
| **Testowe** | `https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc` | `abcde12345abcde12345` (publiczny klucz testowy) |
| **Produkcyjne** | `https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc` | własny klucz z [api.stat.gov.pl/Home/RegonApi](https://api.stat.gov.pl/Home/RegonApi) |

> ⚠️ Środowisko testowe zwraca **dane przykładowe**, nie rzeczywiste. Do
> produkcji potrzebujesz własnego klucza (wniosek przez stronę GUS).

### Przestrzenie nazw (namespaces)

```
soap = http://www.w3.org/2003/05/soap-envelope
ns   = http://CIS/BIR/PUBL/2014/07              (operacje)
dat  = http://CIS/BIR/PUBL/2014/07/DataContract (parametry wyszukiwania)
wsa  = http://www.w3.org/2005/08/addressing     (WS-Addressing, nagłówek)
```

---

## 2. Konfiguracja klucza (zmienna środowiskowa)

Klucz przechowuj **wyłącznie po stronie serwera**. W tym projekcie (SvelteKit +
Vite):

```bash
# .env  — bez przedrostka VITE_, inaczej trafi do bundla przeglądarki!
GUS_API_KEY=your_gus_api_key_here
```

Odczyt na serwerze:

```ts
import { env } from '$env/dynamic/private';
const gusApiKey = env.GUS_API_KEY;
```

> 🔒 **Bezpieczeństwo:** klucz GUS to sekret. Nigdy nie używaj przedrostka
> `VITE_` ani nie wystawiaj go w kodzie klienta. Wszystkie wywołania do GUS
> wykonuj z backendu (endpoint proxy), a frontend odpytuje tylko własny
> endpoint.

---

## 3. Krok 1 — Logowanie (`Zaloguj`)

### Żądanie HTTP

```
POST {BIR_URL}
Content-Type: application/soap+xml; charset=utf-8
```

### Koperta SOAP

```xml
<soap:Envelope
    xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
    xmlns:ns="http://CIS/BIR/PUBL/2014/07"
    xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract">
  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:To>{BIR_URL}</wsa:To>
    <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj</wsa:Action>
  </soap:Header>
  <soap:Body>
    <ns:Zaloguj>
      <ns:pKluczUzytkownika>{GUS_API_KEY}</ns:pKluczUzytkownika>
    </ns:Zaloguj>
  </soap:Body>
</soap:Envelope>
```

### Odpowiedź

Identyfikator sesji zwracany jest w elemencie `<ZalogujResult>`:

```xml
<ZalogujResult>0a1b2c3d4e5f6g7h8i9j</ZalogujResult>
```

- Pusty `ZalogujResult` (lub `""`) oznacza **błędny klucz** albo problem z
  logowaniem — przerwij i zwróć błąd.
- Otrzymany `sid` przekazuj w **nagłówku HTTP `sid`** (nie w body!) we wszystkich
  kolejnych żądaniach.

---

## 4. Krok 2 — Wyszukiwanie podmiotu (`DaneSzukajPodmioty`)

### Żądanie HTTP

```
POST {BIR_URL}
Content-Type: application/soap+xml; charset=utf-8
sid: {ZalogujResult}
```

### Koperta SOAP

Parametr wyszukiwania to jeden z: `<dat:Nip>`, `<dat:Regon>` lub `<dat:Krs>`.

```xml
<soap:Envelope
    xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
    xmlns:ns="http://CIS/BIR/PUBL/2014/07"
    xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract">
  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:To>{BIR_URL}</wsa:To>
    <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty</wsa:Action>
  </soap:Header>
  <soap:Body>
    <ns:DaneSzukajPodmioty>
      <ns:pParametryWyszukiwania>
        <dat:Nip>1234567890</dat:Nip>
      </ns:pParametryWyszukiwania>
    </ns:DaneSzukajPodmioty>
  </soap:Body>
</soap:Envelope>
```

### Odpowiedź

Wynik znajduje się w `<DaneSzukajPodmiotyResult>` jako **zaescape'owany XML**
(encje `&lt;`, `&gt;`, `&amp;`, `&quot;`). Trzeba go najpierw odkodować, a potem
parsować wewnętrzne tagi:

```xml
<DaneSzukajPodmiotyResult>
  &lt;root&gt;&lt;dane&gt;
    &lt;Regon&gt;123456789&lt;/Regon&gt;
    &lt;Nip&gt;1234567890&lt;/Nip&gt;
    &lt;Nazwa&gt;FIRMA SP. Z O.O.&lt;/Nazwa&gt;
    ...
  &lt;/dane&gt;&lt;/root&gt;
</DaneSzukajPodmiotyResult>
```

Najczęściej używane pola wewnętrzne:

| Tag | Znaczenie |
| --- | --- |
| `Regon` | numer REGON |
| `Nip` | numer NIP |
| `Nazwa` | nazwa podmiotu |
| `Ulica` | ulica |
| `NrNieruchomosci` | numer budynku |
| `NrLokalu` | numer lokalu |
| `KodPocztowy` | kod pocztowy |
| `Miejscowosc` | miejscowość |
| `DataZawieszeniaDzialalnosci` | data zawieszenia (jeśli zawieszona) |

Pusty `DaneSzukajPodmiotyResult` lub brak `<Nazwa>` = **nie znaleziono**.

---

## 5. Walidacja NIP / REGON (przed wysłaniem)

Warto zwalidować dane lokalnie, by nie marnować zapytań do GUS.

### NIP (10 cyfr, suma kontrolna)

```ts
function cleanNip(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

function isValidNip(raw: string): boolean {
  const nip = cleanNip(raw);
  if (nip.length !== 10) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
  return sum % 11 === Number(nip[9]);
}
```

### REGON (9 lub 14 cyfr)

```ts
function isValidRegon(raw: string): boolean {
  const r = raw.replace(/[^0-9]/g, '');
  return r.length === 9 || r.length === 14;
}
```

---

## 6. Pełna implementacja referencyjna (TypeScript / SvelteKit)

Minimalny, samodzielny zestaw funkcji — wystarczy podmienić sposób odczytu
klucza na właściwy dla Twojego frameworka.

```ts
const BIR_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const NS =
  'xmlns:soap="http://www.w3.org/2003/05/soap-envelope" ' +
  'xmlns:ns="http://CIS/BIR/PUBL/2014/07" ' +
  'xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract"';

/** Wysyła żądanie SOAP. `sid` przekazujemy w nagłówku HTTP po zalogowaniu. */
async function soap(action: string, body: string, sid?: string): Promise<string> {
  const res = await fetch(BIR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/soap+xml; charset=utf-8',
      ...(sid ? { sid } : {})
    },
    body:
      `<soap:Envelope ${NS}>` +
        `<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">` +
          `<wsa:To>${BIR_URL}</wsa:To>` +
          `<wsa:Action>${action}</wsa:Action>` +
        `</soap:Header>` +
        `<soap:Body>${body}</soap:Body>` +
      `</soap:Envelope>`
  });
  return res.text();
}

/** Prosty ekstraktor pierwszego dopasowanego tagu. */
function extract(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

/** Wyszukuje firmę po NIP. Zwraca dane podstawowe lub null. */
async function lookupByNip(gusApiKey: string, nip: string) {
  // 1. Logowanie
  const loginXml = await soap(
    'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj',
    `<ns:Zaloguj><ns:pKluczUzytkownika>${gusApiKey}</ns:pKluczUzytkownika></ns:Zaloguj>`
  );
  const sid = extract(loginXml, 'ZalogujResult');
  if (!sid) return null; // błędny klucz / brak sesji

  // 2. Wyszukiwanie
  const searchXml = await soap(
    'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty',
    `<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania>` +
      `<dat:Nip>${nip}</dat:Nip>` +
    `</ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`,
    sid
  );

  const raw = extract(searchXml, 'DaneSzukajPodmiotyResult');
  if (!raw) return null;

  // 3. Odkodowanie zaescape'owanego XML i parsowanie pól
  const decoded = raw
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  const nazwa = extract(decoded, 'Nazwa');
  if (!nazwa) return null;

  return {
    nazwa,
    nip: extract(decoded, 'Nip'),
    regon: extract(decoded, 'Regon'),
    ulica: extract(decoded, 'Ulica') ?? '',
    nrNieruchomosci: extract(decoded, 'NrNieruchomosci') ?? '',
    nrLokalu: extract(decoded, 'NrLokalu') ?? '',
    kodPocztowy: extract(decoded, 'KodPocztowy') ?? '',
    miejscowosc: extract(decoded, 'Miejscowosc') ?? '',
    dataZawieszenia: extract(decoded, 'DataZawieszeniaDzialalnosci')
  };
}
```

---

## 7. Przykład wywołania z `curl`

```bash
# 1. Logowanie -> wyciągnij sid z <ZalogujResult>
curl -s -X POST 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc' \
  -H 'Content-Type: application/soap+xml; charset=utf-8' \
  --data-binary '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07"><soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc</wsa:To><wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj</wsa:Action></soap:Header><soap:Body><ns:Zaloguj><ns:pKluczUzytkownika>TWOJ_KLUCZ</ns:pKluczUzytkownika></ns:Zaloguj></soap:Body></soap:Envelope>'

# 2. Wyszukiwanie -> przekaż sid w nagłówku
curl -s -X POST 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc' \
  -H 'Content-Type: application/soap+xml; charset=utf-8' \
  -H 'sid: SID_Z_KROKU_1' \
  --data-binary '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07" xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract"><soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc</wsa:To><wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty</wsa:Action></soap:Header><soap:Body><ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>1234567890</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty></soap:Body></soap:Envelope>'
```

---

## 8. Obsługa błędów i dobre praktyki

| Sytuacja | Reakcja |
| --- | --- |
| Brak `GUS_API_KEY` | Zwróć status „niedostępne" — nie wywołuj GUS. |
| Pusty `ZalogujResult` | Błędny klucz / odrzucone logowanie — przerwij. |
| Pusty wynik / brak `<Nazwa>` | Podmiot nie znaleziony (`found: false`). |
| Wyjątek sieci / timeout | Złap i zaloguj błąd; zwróć neutralną odpowiedź. |
| Nieprawidłowy NIP/REGON | Waliduj lokalnie **przed** zapytaniem (HTTP 400). |

Dodatkowo:

- **Zawsze proxy przez backend** — klucz nie może trafić do przeglądarki.
- **Rate limiting** — GUS limituje liczbę zapytań; rozważ cache wyników po NIP.
- **Wyloguj** (`Wyloguj` z `pIdentyfikatorSesji`) jeśli trzymasz sesję dłużej.
- Do diagnostyki błędów logowania możesz wywołać `GetValue` z parametrem
  `KomunikatKod` / `KomunikatTresc`.

---

## 9. Linki

- Wniosek o klucz produkcyjny: <https://api.stat.gov.pl/Home/RegonApi>
- Dokumentacja GUS BIR 1.1 (PDF/WSDL) dostępna z powyższej strony.
- Endpoint testowy: `https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc`
- Klucz testowy: `abcde12345abcde12345`
