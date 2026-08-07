/* serial-config.js — Supabase config for KMF Quotation Generator
 *
 * SETUP (ek baar, ~5 min):
 *
 * 1. https://supabase.com → New project (free)
 * 2. Project Settings → API → copy Project URL + anon public key
 * 3. SQL Editor → New query → ye poora paste → Run:
 *
 * create table if not exists kmf_counter (
 *   id int primary key default 1 check (id = 1),
 *   last_seq int not null default 0,
 *   last_no text,
 *   updated_at timestamptz default now()
 * );
 * insert into kmf_counter (id, last_seq) values (1, 0)
 *   on conflict (id) do nothing;
 *
 * create table if not exists kmf_history (
 *   quote_no text primary key,
 *   payload jsonb not null,
 *   saved_at timestamptz default now()
 * );
 *
 * create table if not exists kmf_customers (
 *   name_key text primary key,
 *   payload jsonb not null
 * );
 *
 * alter table kmf_counter enable row level security;
 * alter table kmf_history enable row level security;
 * alter table kmf_customers enable row level security;
 *
 * create policy "anon all counter" on kmf_counter
 *   for all to anon using (true) with check (true);
 * create policy "anon all history" on kmf_history
 *   for all to anon using (true) with check (true);
 * create policy "anon all customers" on kmf_customers
 *   for all to anon using (true) with check (true);
 *
 * 4. Neeche URL + KEY paste karo
 */

const SUPABASE_URL = 'https://ywwvpycpqieqgsszeqie.supabase.co/rest/v1/';
// Example: 'https://abcdefgh.supabase.co'

const SUPABASE_ANON_KEY = 'sb_publishable_1MVlZFVDGPK8Izk7b3VJ8g_HnYYBRz9';
// Example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

/** App login PIN */
const APP_PIN = '112266';

/** History mein kitni recent quotations edit ke liye */
const HISTORY_EDIT_LIMIT = 3;
