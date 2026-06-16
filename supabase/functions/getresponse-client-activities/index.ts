import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Read-only GetResponse bridge for the Aura Expert tenant.
// Given a client e-mail, finds the matching GetResponse contact and returns
// the messages that were sent to them, whether/when they were opened.
// The GetResponse API key never leaves the server (Supabase secret).

const GR_BASE = 'https://api.getresponse.com/v3';
// How far back to look for activity (GetResponse returns only the last 14 days
// unless an explicit createdOn[from] is provided).
const HISTORY_DAYS = 730;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type GrContact = { contactId: string; email: string; name?: string };

type GrActivity = {
  activity: string; // 'send' | 'open' | 'click' | 'subscribe' | ...
  subject?: string;
  createdOn?: string;
  resource?: { resourceId?: string; resourceType?: string; href?: string } | null;
};

type NormalizedMessage = {
  id: string;
  subject: string;
  sentOn: string | null;
  openedOn: string | null;
  opened: boolean;
  openCount: number;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // --- Auth: verify the caller and that they belong to the Aura tenant ---
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Brak autoryzacji' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Nieprawidłowa sesja' }, 401);

  const { data: profile } = await supabase
    .from('crm_profiles')
    .select('tenant_id, crm_tenants(nazwa)')
    .eq('id', userData.user.id)
    .single();

  const tenantName: string =
    (profile as { crm_tenants?: { nazwa?: string } } | null)?.crm_tenants?.nazwa ?? '';
  if (!tenantName.toLowerCase().includes('aura')) {
    return json({ error: 'Funkcja dostępna tylko dla Aura Expert' }, 403);
  }

  const apiKey = (
    Deno.env.get('AEX2_GETRESPONSE_API_KEY') ??
    Deno.env.get('AEX_GETRESPONSE_API_KEY') ??
    ''
  ).trim();
  if (!apiKey) return json({ error: 'Brak skonfigurowanego klucza GetResponse' }, 500);

  // --- Input ---
  let email = '';
  try {
    const body = await req.json();
    email = String(body?.email ?? '').trim().toLowerCase();
  } catch {
    return json({ error: 'Nieprawidłowe dane wejściowe' }, 400);
  }
  if (!email) return json({ matched: false, reason: 'no_email' });

  const grHeaders = { 'X-Auth-Token': `api-key ${apiKey}`, 'Content-Type': 'application/json' };

  try {
    // 1) Find the contact by e-mail.
    const contactUrl = `${GR_BASE}/contacts?query[email]=${encodeURIComponent(email)}&fields=contactId,email,name&perPage=1`;
    const contactRes = await fetch(contactUrl, { headers: grHeaders });
    if (!contactRes.ok) {
      const detail = await contactRes.text();
      console.error('GR contacts lookup failed', contactRes.status, detail);
      return json({ error: `GetResponse: ${contactRes.status}`, detail }, 502);
    }
    const contacts = (await contactRes.json()) as GrContact[];
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return json({ matched: false, reason: 'not_found', email });
    }
    const contact = contacts[0];

    // 2) Pull activities (paginated) since HISTORY_DAYS ago.
    const from = new Date();
    from.setDate(from.getDate() - HISTORY_DAYS);
    const fromStr = from.toISOString().slice(0, 10);

    const activities: GrActivity[] = [];
    for (let page = 1; page <= 10; page++) {
      const actUrl =
        `${GR_BASE}/contacts/${contact.contactId}/activities` +
        `?query[createdOn][from]=${fromStr}&sort[createdOn]=desc&perPage=1000&page=${page}`;
      const actRes = await fetch(actUrl, { headers: grHeaders });
      if (!actRes.ok) {
        const detail = await actRes.text();
        console.error('GR activities failed', actRes.status, actUrl, detail);
        return json({ error: `GetResponse activities: ${actRes.status}`, detail }, 502);
      }
      const batch = (await actRes.json()) as GrActivity[];
      if (!Array.isArray(batch) || batch.length === 0) break;
      activities.push(...batch);
      const totalPages = Number(actRes.headers.get('TotalPages') ?? '1');
      if (page >= totalPages) break;
    }

    // 3) Normalize into per-message rows: sent + opened (clicks ignored).
    const byMessage = new Map<string, NormalizedMessage>();
    const keyOf = (a: GrActivity) =>
      a.resource?.resourceId ?? a.subject ?? `${a.activity}-${a.createdOn}`;

    for (const a of activities) {
      const type = (a.activity ?? '').toLowerCase();
      if (type !== 'send' && type !== 'open') continue;
      const key = keyOf(a);
      const existing =
        byMessage.get(key) ??
        ({ id: key, subject: a.subject ?? '(bez tematu)', sentOn: null, openedOn: null, opened: false, openCount: 0 } as NormalizedMessage);
      if (a.subject && existing.subject === '(bez tematu)') existing.subject = a.subject;

      if (type === 'send') {
        // keep the earliest send timestamp
        if (!existing.sentOn || (a.createdOn && a.createdOn < existing.sentOn)) {
          existing.sentOn = a.createdOn ?? existing.sentOn;
        }
      } else if (type === 'open') {
        existing.opened = true;
        existing.openCount += 1;
        // keep the earliest open timestamp (first open)
        if (!existing.openedOn || (a.createdOn && a.createdOn < existing.openedOn)) {
          existing.openedOn = a.createdOn ?? existing.openedOn;
        }
      }
      byMessage.set(key, existing);
    }

    const messages = [...byMessage.values()].sort((x, y) => {
      const dx = x.sentOn ?? x.openedOn ?? '';
      const dy = y.sentOn ?? y.openedOn ?? '';
      return dy.localeCompare(dx);
    });

    return json({
      matched: true,
      contact: { contactId: contact.contactId, email: contact.email, name: contact.name ?? null },
      messages,
    });
  } catch (err: unknown) {
    console.error('GR function error', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
