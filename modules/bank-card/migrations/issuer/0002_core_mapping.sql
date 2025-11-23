create table if not exists issuer.card_account_links (
  id                 bigserial primary key,
  card_id            uuid not null references issuer.cards(card_id) on delete cascade,
  core_account_id    text not null,
  account_no         text,
  external_id        text,
  customer_id        bigint not null,
  product_id         bigint,
  currency_code      char(3),
  activated_on       date,
  core_status        text not null,
  core_sub_status    text,
  link_status        text not null default 'BOUND',
  request_id         text not null,
  last_core_sync_at  timestamptz,
  last_core_sync_result text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint uq_card_account_links_core unique (core_account_id),
  constraint uq_card_account_links_request unique (request_id),
  constraint uq_card_account_links_card unique (card_id)
);
create trigger trg_card_account_links_updated before update on issuer.card_account_links
for each row execute function issuer_set_updated_at();
create index if not exists idx_card_account_links_core on issuer.card_account_links(core_account_id);
create index if not exists idx_card_account_links_request on issuer.card_account_links(request_id);
create index if not exists idx_card_account_links_customer on issuer.card_account_links(customer_id);
