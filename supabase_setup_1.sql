-- ============================================================================
-- Personal News Aggregator — Setup iniziale Supabase
-- ============================================================================
-- Come usarlo:
-- 1. Vai sul tuo progetto Supabase → SQL Editor → New query
-- 2. Incolla tutto questo file ed esegui (Run)
-- 3. Verifica in Table Editor che le 4 tabelle esistano e che
--    categories/sources siano popolate
-- ============================================================================

-- Estensione necessaria per generare UUID automaticamente
create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. TABELLA categories
-- ============================================================================
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 2. TABELLA sources
-- ============================================================================
create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feed_url text not null unique,
  category_id uuid not null references categories(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 3. TABELLA articles
-- ============================================================================
create table articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id),
  category_id uuid not null references categories(id),
  title text not null,
  link text not null unique,
  summary text,
  full_content text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  image_url text
);

-- Indici per le query più frequenti del frontend
create index idx_articles_published_at on articles (published_at desc);
create index idx_articles_category_id on articles (category_id);
create index idx_articles_source_id on articles (source_id);

-- Full-text search su titolo + estratto (per la funzionalità di ricerca)
alter table articles add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('italian', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('italian', coalesce(summary, '')), 'B')
  ) stored;

create index idx_articles_search on articles using gin (search_vector);

-- ============================================================================
-- 4. TABELLA user_article_state
-- ============================================================================
-- Single-user: una riga per articolo, niente user_id
create table user_article_state (
  article_id uuid primary key references articles(id) on delete cascade,
  is_read boolean not null default false,
  is_saved boolean not null default false,
  read_at timestamptz,
  saved_at timestamptz
);

-- ============================================================================
-- 5. POPOLAMENTO categories (le 7 categorie definite)
-- ============================================================================
insert into categories (name, slug) values
  ('Finanza', 'finanza'),
  ('Economia e business', 'economia-business'),
  ('Politica interna e internazionale', 'politica'),
  ('Cronaca interna', 'cronaca'),
  ('AI', 'ai'),
  ('News settore pagamenti e agentic ecommerce', 'pagamenti-ecommerce'),
  ('Serie A e AS Roma', 'serie-a-as-roma');

-- ============================================================================
-- 6. POPOLAMENTO sources (i 16 feed RSS validati nel PROJECT.md, sezione 4bis)
-- ============================================================================

-- Finanza
insert into sources (name, feed_url, category_id) values
  ('MarketWatch - Real-time Headlines', 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
    (select id from categories where slug = 'finanza')),
  ('MarketWatch - Bulletins', 'https://feeds.content.dowjones.io/public/rss/mw_bulletins',
    (select id from categories where slug = 'finanza')),
  ('Il Sole 24 Ore - Finanza, Business', 'https://www.ilsole24ore.com/rss/finanza--business.xml',
    (select id from categories where slug = 'finanza')),
  ('Il Sole 24 Ore - Finanza personale, Investimenti', 'https://www.ilsole24ore.com/rss/finanza-personale--investimenti.xml',
    (select id from categories where slug = 'finanza'));

-- Economia e business
insert into sources (name, feed_url, category_id) values
  ('Il Sole 24 Ore - Economia', 'https://www.ilsole24ore.com/rss/economia.xml',
    (select id from categories where slug = 'economia-business')),
  ('Il Sole 24 Ore - Italia, Attualità', 'https://www.ilsole24ore.com/rss/italia--attualita.xml',
    (select id from categories where slug = 'economia-business'));

-- Politica interna e internazionale
insert into sources (name, feed_url, category_id) values
  ('Il Sole 24 Ore - Italia, Politica', 'https://www.ilsole24ore.com/rss/italia--politica.xml',
    (select id from categories where slug = 'politica')),
  ('Il Sole 24 Ore - Italia, Politica economica', 'https://www.ilsole24ore.com/rss/italia--politica-economica.xml',
    (select id from categories where slug = 'politica')),
  ('Il Sole 24 Ore - Mondo, Europa', 'https://www.ilsole24ore.com/rss/mondo--europa.xml',
    (select id from categories where slug = 'politica')),
  ('Il Sole 24 Ore - Mondo, USA', 'https://www.ilsole24ore.com/rss/mondo--usa.xml',
    (select id from categories where slug = 'politica')),
  ('Il Sole 24 Ore - Mondo, Medio Oriente', 'https://www.ilsole24ore.com/rss/mondo--medio-oriente.xml',
    (select id from categories where slug = 'politica')),
  ('Il Sole 24 Ore - Mondo, Asia e Oceania', 'https://www.ilsole24ore.com/rss/mondo--asia-e-oceania.xml',
    (select id from categories where slug = 'politica')),
  ('La Repubblica - Politica', 'http://www.repubblica.it/rss/politica/rss2.0.xml',
    (select id from categories where slug = 'politica')),
  ('La Repubblica - Esteri', 'http://www.repubblica.it/rss/esteri/rss2.0.xml',
    (select id from categories where slug = 'politica'));

-- Cronaca interna
insert into sources (name, feed_url, category_id) values
  ('La Repubblica - Cronaca', 'http://www.repubblica.it/rss/cronaca/rss2.0.xml',
    (select id from categories where slug = 'cronaca')),
  ('ANSA - Cronaca', 'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml',
    (select id from categories where slug = 'cronaca'));

-- AI
insert into sources (name, feed_url, category_id) values
  ('TechCrunch - AI', 'https://techcrunch.com/category/artificial-intelligence/feed/',
    (select id from categories where slug = 'ai')),
  ('MIT Technology Review - AI', 'https://www.technologyreview.com/topic/artificial-intelligence/feed/',
    (select id from categories where slug = 'ai'));

-- News settore pagamenti e agentic ecommerce
insert into sources (name, feed_url, category_id) values
  ('Il Sole 24 Ore - Finanza, Fintech e startup', 'https://www.ilsole24ore.com/rss/finanza--fintech-e-startup.xml',
    (select id from categories where slug = 'pagamenti-ecommerce')),
  ('Il Sole 24 Ore - Tecnologia, Fintech', 'https://www.ilsole24ore.com/rss/tecnologia--fintech.xml',
    (select id from categories where slug = 'pagamenti-ecommerce'));

-- Serie A e AS Roma
insert into sources (name, feed_url, category_id) values
  ('La Repubblica - Sport, Calcio', 'https://www.repubblica.it/rss/sport/calcio/rss2.0.xml',
    (select id from categories where slug = 'serie-a-as-roma')),
  ('La Repubblica - Sport, Serie A', 'https://www.repubblica.it/rss/sport/serie-a/rss2.0.xml',
    (select id from categories where slug = 'serie-a-as-roma')),
  ('ForzaRoma.info', 'https://www.forzaroma.info/feed',
    (select id from categories where slug = 'serie-a-as-roma')),
  ('Giallorossi.net', 'https://www.giallorossi.net/feed/',
    (select id from categories where slug = 'serie-a-as-roma'));

-- ============================================================================
-- Verifica finale (facoltativo, per controllare subito che sia andato tutto bene)
-- ============================================================================
-- select c.name as categoria, count(s.id) as num_fonti
-- from categories c
-- left join sources s on s.category_id = c.id
-- group by c.name
-- order by c.name;
