-- ST1 plans (Codex review): a box keeps the workflows its plan included when it got the plan,
-- as it keeps the plan's price and terms; a later change of the plan applies to later boxes only.
ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS included_bundles jsonb;
