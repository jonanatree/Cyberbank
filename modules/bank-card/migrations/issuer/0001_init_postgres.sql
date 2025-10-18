create schema if not exists issuer;

create or replace function issuer_set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

create table if not exists issuer.accounts (
  account_id        uuid primary key,
  core_account_id   text not null,
  currency          char(3) not null,
  available_balance bigint  not null default 0 check (available_balance >= 0),
  hold_balance      bigint  not null default 0 check (hold_balance      >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_currency_upper check (currency = upper(currency))
);
create trigger trg_accounts_updated before update on issuer.accounts
for each row execute function issuer_set_updated_at();
create index if not exists idx_accounts_core on issuer.accounts(core_account_id);

create table if not exists issuer.cards (
  card_id       uuid primary key,
  account_id    uuid not null references issuer.accounts(account_id) on delete restrict,
  bin           varchar(9) not null,
  last4         char(4)    not null,
  expiry_yymm   char(4)    not null,
  status        text       not null default 'ISSUED',
  pan_hash      bytea      not null,
  pan_token     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_cards_pan_hash unique (pan_hash),
  constraint chk_expiry_len   check (char_length(expiry_yymm)=4),
  constraint chk_expiry_month check (substring(expiry_yymm from 3 for 2) ~ '^(0[1-9]|1[0-2])$'),
  constraint chk_status       check (status in ('ISSUED','ACTIVE','FROZEN','LOST','STOLEN','CLOSED'))
);
create trigger trg_cards_updated before update on issuer.cards
for each row execute function issuer_set_updated_at();
create index if not exists idx_cards_account on issuer.cards(account_id);
create index if not exists idx_cards_status  on issuer.cards(status);

create table if not exists issuer.auths (
  auth_id       uuid primary key,
  account_id    uuid not null references issuer.accounts(account_id) on delete restrict,
  card_id       uuid not null references issuer.cards(card_id)       on delete restrict,
  amount        bigint  not null check (amount > 0),
  currency      char(3) not null,
  status        text    not null,
  approval_code char(6),
  authorization_code char(6),
  stan          int,
  merchant_name text,
  mcc           char(4),
  hold_expires_at timestamptz,
  created_at    timestamptz not null default now()
);
-- ensure idempotency unique index is partial (stan is not null)
drop index if exists uq_auth_card_stan;
create unique index if not exists uq_auth_card_stan
  on issuer.auths(card_id, stan)
  where stan is not null;
create index if not exists idx_auths_hold_expiry
  on issuer.auths(hold_expires_at)
  where status = 'AUTHORIZED';
create index if not exists idx_auths_acc_open on issuer.auths(account_id) where status='AUTHORIZED';

create table if not exists issuer.transactions (
  tx_id        uuid primary key,
  account_id   uuid not null references issuer.accounts(account_id) on delete restrict,
  card_id      uuid not null references issuer.cards(card_id)       on delete restrict,
  auth_id      uuid references issuer.auths(auth_id),
  amount       bigint  not null check (amount <> 0),
  currency     char(3) not null,
  status       text    not null,
  authorization_code char(6),
  posted_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_tx_acc_created on issuer.transactions(account_id, created_at desc);
