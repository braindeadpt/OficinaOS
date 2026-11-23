-- Follow-up to 20261228000000_meta_safe_whatsapp_template_bodies: the
-- single-pass repair only fixed the FIRST variable in a trailing
-- conditional chain — the 'g' replacement consumed the remaining
-- {{if}}…{{var}}{{endif}} blocks as its lookahead tail, so e.g.
--   …{{trackingUrl}}{{endif}}{{if shopName}} — {{shopName}}{{endif}}$
-- gained "." after trackingUrl but left {{shopName}} terminal, and Meta
-- still refused the expanded body ("body can't end in a parameter").
-- Postgres has no lookahead, so repeat the same repair until no row
-- changes: each pass fixes the next block inward and the WHERE stays
-- true while any unfixed terminal variable remains.
DO $$
DECLARE
  changed integer;
  passes integer := 0;
BEGIN
  LOOP
    UPDATE "notification_templates"
    SET body = regexp_replace(
      body,
      '(\{\{\w+\}\})(\{\{endif\}\})(([[:space:]]*\{\{if[^{}]*\}\}.*?\{\{endif\}\})*[[:space:]]*$)',
      '\1.\2\3',
      'g'
    )
    WHERE channel = 'WHATSAPP'
      AND body ~ '\{\{\w+\}\}\{\{endif\}\}([[:space:]]*\{\{if[^{}]*\}\}.*?\{\{endif\}\})*[[:space:]]*$';
    GET DIAGNOSTICS changed = ROW_COUNT;
    passes := passes + 1;
    EXIT WHEN changed = 0 OR passes >= 10;
  END LOOP;
END $$;
