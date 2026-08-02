-- buno — board-execution round: the two-time model (work vs waiting) + the "why".
-- Additive and idempotent. Existing cards default to 'work' with no waiting fields,
-- so nothing changes until buno/the user marks a card as waiting or adds an estimate.

-- ---- B1: two-time model on card -------------------------------------------
-- card_type: 'work' = something the user does; 'waiting' = delegated / awaiting a
-- reply. Capacity (hara-hachi-bu) counts work only; kaizen never nags a waiting card.
alter table card add column if not exists card_type text not null default 'work'
  check (card_type in ('work','waiting'));
-- who/what the card is waiting on (free text, e.g. "העירייה", "ספק X").
alter table card add column if not exists waiting_on text;
-- after how many silent days a waiting card earns a follow-up nudge.
-- convention at create time: supplier 7 · authority 30 · other 14.
alter table card add column if not exists follow_up_days int;
-- an explicit time estimate in hours. Capacity sums estimates of work cards;
-- a card with no estimate is NOT counted (the snapshot notes how many lack one).
alter table card add column if not exists estimate_hours numeric;

-- ---- D1: the project "why" -------------------------------------------------
-- a one-line purpose for the board, edited in project settings, injected into the
-- assistant's board context and echoed by a repeat kaizen nudge.
alter table project add column if not exists why text;
