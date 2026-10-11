import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// Codzienna synchronizacja firm z projektu BEAUTY (crm_companies) do klientów Aura Expert w CRM.
// Woła ją wyłącznie pg_cron przez public.aura_sync_beauty_companies() (nagłówek x-cron-token z Vaulta).
//
// Zasady (od 2026-10-08):
// - Rekord w CRM jest nadrzędny. Istniejący klient dostaje z BEAUTY tylko to, czego mu brakuje (puste pola);
//   nic, co poprawiono w CRM (nazwa, e-mail, telefon, adres), nie jest nadpisywane.
// - Zgoda RODO nigdy nie jest cofana: BEAUTY może ją najwyżej ustawić na TAK.
// - Firma z BEAUTY bez odpowiednika po beauty_id jest dopasowywana po NIP (a bez NIP — po e-mailu).
//   Gdy w CRM jest już klient z tym NIP, nowy rekord NIE powstaje: rekordem bazowym jest klient z polisą
//   (a przy remisie — najstarszy). Jeśli bazowy nie ma jeszcze beauty_id, dostaje identyfikator tej firmy;
//   jeśli ma inny, firma z BEAUTY jest duplikatem po tamtej stronie i jest pomijana.
// - Leady (od 2026-10-12): zainteresowania z formularza (ubezpieczenie, zainteresowania), przychód i data
//   zgłoszenia trafiają do leada klienta (public.crm_beauty_leady); firma bez polisy i bez leada dostaje lead.
// - Maile kampanii (email_messages) trafiają do crm_kampanie_maile ze statusem dostarczenia, otwarcia i kliknięcia.
// - Treść { "proba": true } liczy, co by się zmieniło, bez zapisu.
// Wcześniejsza wersja robiła upsert całych rekordów po beauty_id: odtwarzała usunięte duplikaty
// i co rano przywracała dane z BEAUTY (w tym RODO = NIE).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AURA_EXPERT_TENANT_ID = '9dabd3a0-f1ee-43bc-92a1-6137ac814100';
const BEAUTY_URL = 'https://dhuvykwecsxgchzxufxw.supabase.co';
const PAGE_SIZE = 1000;

type Firma = { id: number | string; company: string | null; city: string | null; state: string | null; nip: string | null; regon: string | null; rodo: string | null; email: string | null; phone: string | null; contact: string | null; title: string | null; ubezpieczenie: string | null; zainteresowania: string | null; przychod: string | null; created_at: string | null };
type Mail = { id: string; company_id: number | null; category_id: string | null; to_email: string | null; status: string | null; sent_at: string | null; delivered_at: string | null; opened_at: string | null; clicked_at: string | null; bounced_at: string | null; created_at: string | null };
type Kategoria = { id: string; code: string | null; name: string | null; subject: string | null };
type Klient = { id: string; beauty_id: number | string | null; nazwa: string | null; ulica: string | null; nip: string | null; regon: string | null; email: string | null; telefon: string | null; rodo_zgoda: boolean | null; created_at: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

const pusty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const nipCyfry = (v: string | null) => (v ?? '').replace(/\D/g, '');
const emailNorm = (v: string | null) => (v ?? '').trim().toLowerCase();
const rodoTak = (v: string | null) => !!(v && v !== '' && v !== 'brak');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  const BEAUTY_KEY = Deno.env.get('BEAUTY_SERVICE_ROLE_KEY') ?? '';
  const AURA_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const AURA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const aura = (path: string, init: RequestInit = {}) =>
    fetch(`${AURA_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: AURA_KEY, Authorization: `Bearer ${AURA_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

  // Bramka przed czymkolwiek innym — obcy nie dowie się nawet, jak funkcja jest skonfigurowana.
  const token = req.headers.get('x-cron-token') ?? '';
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const sprawdzenie = await aura('rpc/edge_cron_token_matches', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => null);
  if (!sprawdzenie?.ok) {
    console.error('Nie mogę sprawdzić tokenu:', sprawdzenie?.status);
    return json({ error: 'Token check failed' }, 500);
  }
  if ((await sprawdzenie.json()) !== true) return json({ error: 'Unauthorized' }, 401);
  if (!BEAUTY_KEY) return json({ error: 'BEAUTY_SERVICE_ROLE_KEY not configured' }, 500);

  const body = await req.json().catch(() => ({}));
  const proba = body?.proba === true;

  let logId: string | null = null;
  if (!proba) {
    try {
      const logRes = await aura('crm_sync_log', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ tenant_id: AURA_EXPERT_TENANT_ID, source: 'beauty.crm_companies', status: 'running' }),
      });
      if (logRes.ok) { const d = await logRes.json(); logId = Array.isArray(d) ? d[0]?.id : d?.id; }
    } catch (_) { /* dziennik nie blokuje synchronizacji */ }
  }
  const finishLog = async (status: string, records: number, error?: string) => {
    if (!logId) return;
    await aura(`crm_sync_log?id=eq.${logId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, records_synced: records, finished_at: new Date().toISOString(), ...(error ? { error } : {}) }),
    }).catch(() => {});
  };

  // Wszystkie strony zapytania (PostgREST zwraca maks. PAGE_SIZE wierszy).
  async function wszystkie<T>(pobierz: (offset: number) => Promise<Response>, opis: string): Promise<T[]> {
    const wynik: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const res = await pobierz(offset);
      if (!res.ok) throw new Error(`${opis} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const strona = (await res.json()) as T[];
      wynik.push(...strona);
      if (strona.length < PAGE_SIZE) return wynik;
    }
  }

  try {
    const firmy = await wszystkie<Firma>(
      (o) => fetch(`${BEAUTY_URL}/rest/v1/crm_companies?select=id,company,city,state,nip,regon,rodo,email,phone,contact,title,ubezpieczenie,zainteresowania,przychod,created_at&order=id.asc&limit=${PAGE_SIZE}&offset=${o}`, {
        headers: { apikey: BEAUTY_KEY, Authorization: `Bearer ${BEAUTY_KEY}` },
      }),
      'BEAUTY',
    );
    const klienci = await wszystkie<Klient>(
      (o) => aura(`crm_clients?select=id,beauty_id,nazwa,ulica,nip,regon,email,telefon,rodo_zgoda,created_at&tenant_id=eq.${AURA_EXPERT_TENANT_ID}&order=id.asc&limit=${PAGE_SIZE}&offset=${o}`),
      'CRM klienci',
    );
    const polisy = await wszystkie<{ klient_id: string | null; ubezpieczony_id: string | null }>(
      (o) => aura(`crm_policies?select=klient_id,ubezpieczony_id&tenant_id=eq.${AURA_EXPERT_TENANT_ID}&deleted_at=is.null&order=id.asc&limit=${PAGE_SIZE}&offset=${o}`),
      'CRM polisy',
    );

    const liczbaPolis = new Map<string, number>();
    for (const p of polisy) for (const k of [p.klient_id, p.ubezpieczony_id]) if (k) liczbaPolis.set(k, (liczbaPolis.get(k) ?? 0) + 1);

    const poBeauty = new Map<string, Klient>();
    const poNip = new Map<string, Klient[]>();
    const poEmailu = new Map<string, Klient[]>();
    const dodajDoMap = (k: Klient) => {
      if (k.beauty_id != null) poBeauty.set(String(k.beauty_id), k);
      const nip = nipCyfry(k.nip);
      if (nip.length === 10) poNip.set(nip, [...(poNip.get(nip) ?? []), k]);
      const em = emailNorm(k.email);
      if (em) poEmailu.set(em, [...(poEmailu.get(em) ?? []), k]);
    };
    klienci.forEach(dodajDoMap);

    // Rekord bazowy: klient z polisą, potem bez beauty_id (założony w CRM), potem najstarszy.
    const bazowy = (kandydaci: Klient[]) =>
      [...kandydaci].sort((a, b) =>
        (liczbaPolis.get(b.id) ?? 0) - (liczbaPolis.get(a.id) ?? 0) ||
        Number(a.beauty_id != null) - Number(b.beauty_id != null) ||
        a.created_at.localeCompare(b.created_at),
      )[0];

    const ulicaZ = (f: Firma) => [f.city, f.state].filter(Boolean).join(', ') || null;
    // Tylko puste pola klienta; RODO wyłącznie w górę.
    const uzupelnienie = (k: Klient, f: Firma): Record<string, unknown> => {
      const z: Record<string, unknown> = {};
      if ((pusty(k.nazwa) || k.nazwa === '(brak nazwy)') && !pusty(f.company)) z.nazwa = f.company;
      if (pusty(k.ulica) && ulicaZ(f)) z.ulica = ulicaZ(f);
      if (pusty(k.nip) && !pusty(f.nip)) z.nip = f.nip;
      if (pusty(k.regon) && !pusty(f.regon)) z.regon = f.regon;
      if (pusty(k.email) && !pusty(f.email)) z.email = f.email;
      if (pusty(k.telefon) && !pusty(f.phone)) z.telefon = f.phone;
      if (k.rodo_zgoda !== true && rodoTak(f.rodo)) { z.rodo_zgoda = true; z.rodo_kanal = 'Import BEAUTY'; }
      return z;
    };

    const nowe: Record<string, unknown>[] = [];
    const zmiany: { id: string; z: Record<string, unknown> }[] = [];
    const klientDlaFirmy = new Map<string, string>(); // beauty_id → id klienta (do kontaktów)
    // Także duplikaty po stronie BEAUTY (ten sam NIP) → klient bazowy: ich zainteresowania i maile należą do tej firmy.
    const klientFirmyLubDuplikatu = new Map<string, string>();
    const licznik = { firm: firmy.length, nowi: 0, polaczeni: 0, uzupelnieni: 0, pominiete_duplikaty: 0 };

    for (const f of firmy) {
      const bid = String(f.id);
      let k = poBeauty.get(bid);
      if (!k) {
        const nip = nipCyfry(f.nip);
        const em = emailNorm(f.email);
        const kandydaci = nip.length === 10
          ? poNip.get(nip) ?? []
          : em ? (poEmailu.get(em) ?? []).filter((x) => nipCyfry(x.nip).length !== 10) : [];
        if (kandydaci.length) {
          const b = bazowy(kandydaci);
          if (b.beauty_id != null) {
            licznik.pominiete_duplikaty++;
            if (!b.id.startsWith('nowy:')) klientFirmyLubDuplikatu.set(bid, b.id);
            continue;
          }
          const z = { beauty_id: f.id, ...uzupelnienie(b, f) };
          zmiany.push({ id: b.id, z });
          b.beauty_id = f.id;
          poBeauty.set(bid, b);
          klientDlaFirmy.set(bid, b.id);
          licznik.polaczeni++;
          continue;
        }
        const nowy = {
          tenant_id: AURA_EXPERT_TENANT_ID,
          beauty_id: f.id,
          typ: 'firma',
          nazwa: f.company ?? '(brak nazwy)',
          ulica: ulicaZ(f),
          nip: f.nip || null,
          regon: f.regon || null,
          email: f.email || null,
          telefon: f.phone || null,
          rodo_zgoda: rodoTak(f.rodo),
          rodo_data: null,
          rodo_kanal: 'Import BEAUTY',
        };
        nowe.push(nowy);
        // Druga firma z tym samym NIP w tym samym przebiegu też nie zrobi duplikatu.
        dodajDoMap({ id: `nowy:${bid}`, beauty_id: f.id, nazwa: nowy.nazwa, ulica: nowy.ulica, nip: nowy.nip, regon: nowy.regon, email: nowy.email, telefon: nowy.telefon, rodo_zgoda: nowy.rodo_zgoda, created_at: '9999' });
        licznik.nowi++;
        continue;
      }
      klientDlaFirmy.set(bid, k.id);
      const z = uzupelnienie(k, f);
      if (Object.keys(z).length) {
        zmiany.push({ id: k.id, z });
        licznik.uzupelnieni++;
      }
    }

    if (proba) {
      return json({ proba: true, ...licznik, przyklady_polaczen: zmiany.filter((x) => 'beauty_id' in x.z).slice(0, 5).map((x) => x.id) });
    }

    for (const { id, z } of zmiany) {
      const res = await aura(`crm_clients?id=eq.${id}&tenant_id=eq.${AURA_EXPERT_TENANT_ID}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(z) });
      if (!res.ok) throw new Error(`Aktualizacja klienta ${id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    for (let i = 0; i < nowe.length; i += 100) {
      const res = await aura('crm_clients?on_conflict=beauty_id,tenant_id&select=id,beauty_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(nowe.slice(i, i + 100)),
      });
      if (!res.ok) throw new Error(`Nowi klienci ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      for (const r of (await res.json()) as { id: string; beauty_id: number | string }[]) klientDlaFirmy.set(String(r.beauty_id), r.id);
    }

    // Osoba kontaktowa z BEAUTY — tylko gdy jej jeszcze nie ma (kontakty poprawione w CRM zostają).
    const kontakty = firmy
      .filter((f) => f.contact && f.contact.trim() !== '' && klientDlaFirmy.has(String(f.id)))
      .map((f) => ({
        tenant_id: AURA_EXPERT_TENANT_ID,
        beauty_id: f.id,
        klient_id: klientDlaFirmy.get(String(f.id)),
        imie_nazwisko: f.contact!.trim(),
        stanowisko: f.title || null,
        telefon: f.phone || null,
        email: f.email || null,
        notatki: 'Sync z Beauty CRM',
      }));
    for (let i = 0; i < kontakty.length; i += 100) {
      const res = await aura('crm_client_contacts?on_conflict=tenant_id,beauty_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(kontakty.slice(i, i + 100)),
      });
      if (!res.ok) console.error(`Kontakty ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }

    for (const [bid, id] of klientDlaFirmy) klientFirmyLubDuplikatu.set(bid, id);

    // Leady: zainteresowania, przychód i data zgłoszenia z formularza (funkcja w bazie uzupełnia tylko braki).
    const leady = { nowe_leady: 0, uzupelnione: 0 };
    const wierszeLeadow = firmy
      .filter((f) => klientFirmyLubDuplikatu.has(String(f.id)))
      .map((f) => ({
        klient_id: klientFirmyLubDuplikatu.get(String(f.id)),
        ubezpieczenie: f.ubezpieczenie,
        zainteresowania: f.zainteresowania,
        przychod: f.przychod,
        data: f.created_at,
      }));
    for (let i = 0; i < wierszeLeadow.length; i += 500) {
      const res = await aura('rpc/crm_beauty_leady', {
        method: 'POST',
        body: JSON.stringify({ p_tenant: AURA_EXPERT_TENANT_ID, p_wiersze: wierszeLeadow.slice(i, i + 500) }),
      });
      if (!res.ok) {
        console.error(`Leady ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`);
        continue;
      }
      const d = (await res.json()) as { nowe_leady?: number; uzupelnione?: number };
      leady.nowe_leady += d.nowe_leady ?? 0;
      leady.uzupelnione += d.uzupelnione ?? 0;
    }

    // Maile kampanii wysłane z BEAUTY (Aura HUB) — z ich statusem; kolejne przebiegi odświeżają otwarcia i kliknięcia.
    let maile = 0;
    try {
      const beauty = (path: string) => fetch(`${BEAUTY_URL}/rest/v1/${path}`, { headers: { apikey: BEAUTY_KEY, Authorization: `Bearer ${BEAUTY_KEY}` } });
      const kategorie = await wszystkie<Kategoria>((o) => beauty(`email_categories?select=id,code,name,subject&order=id.asc&limit=${PAGE_SIZE}&offset=${o}`), 'BEAUTY kategorie');
      const kategoria = new Map(kategorie.map((k) => [k.id, k]));
      const wyslane = await wszystkie<Mail>(
        (o) => beauty(`email_messages?select=id,company_id,category_id,to_email,status,sent_at,delivered_at,opened_at,clicked_at,bounced_at,created_at&resend_id=not.is.null&order=id.asc&limit=${PAGE_SIZE}&offset=${o}`),
        'BEAUTY maile',
      );
      const wiersze = wyslane
        .filter((m) => m.company_id != null && klientFirmyLubDuplikatu.has(String(m.company_id)))
        .map((m) => {
          const k = m.category_id ? kategoria.get(m.category_id) : undefined;
          return {
            tenant_id: AURA_EXPERT_TENANT_ID,
            klient_id: klientFirmyLubDuplikatu.get(String(m.company_id)),
            zrodlo: 'beauty',
            zewn_id: m.id,
            kampania: k?.name ?? null,
            kod: k?.code ?? null,
            temat: k?.subject ?? null,
            adres: m.to_email,
            status: m.status,
            wyslano_at: m.sent_at ?? m.created_at,
            dostarczono_at: m.delivered_at,
            otwarto_at: m.opened_at,
            kliknieto_at: m.clicked_at,
            odbito_at: m.bounced_at,
            zaktualizowano_at: new Date().toISOString(),
          };
        });
      for (let i = 0; i < wiersze.length; i += 500) {
        const res = await aura('crm_kampanie_maile?on_conflict=tenant_id,zrodlo,zewn_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(wiersze.slice(i, i + 500)),
        });
        if (!res.ok) throw new Error(`Maile ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`);
        maile += Math.min(500, wiersze.length - i);
      }
    } catch (e) {
      // Maile są dodatkiem — błąd nie przerywa synchronizacji klientów.
      console.error('Maile kampanii:', (e as Error).message);
    }

    await finishLog('done', licznik.nowi + licznik.polaczeni + licznik.uzupelnieni);
    return json({ ...licznik, kontakty: kontakty.length, ...leady, maile });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    await finishLog('error', 0, msg.slice(0, 500));
    console.error(msg);
    return json({ error: 'Synchronizacja nie powiodła się' }, 500);
  }
});
