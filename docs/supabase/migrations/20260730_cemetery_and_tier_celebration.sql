-- Applied to the 'mirroir' Supabase project via MCP. Kept here for version control.
--
-- Abandoned habits keep existing (active=false, never hard-deleted) so their
-- card can be shown in a "cemetery" rather than disappearing. deleted_at lets
-- the client freeze a dead card's age at the moment of abandonment instead of
-- letting it keep climbing with today's date.
alter table public.habits add column deleted_at timestamptz;

-- Tracks the last tier the user has actually seen celebrated. Tier is
-- age-based (how long a promise has survived without being abandoned), not
-- success-based, so it can cross a threshold on any given day; this lets the
-- client fire its one fireworks moment exactly once per crossing rather than
-- replaying it on every visit.
alter table public.habits add column celebrated_tier text not null default 'oeuf';
