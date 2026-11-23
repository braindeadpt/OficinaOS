-- Meta rejects a message template whose BODY starts or ends with a
-- positional parameter — the submission never reaches review, which left
-- job-done, quote and signature notifications unsendable in cloud mode.
-- Every seeded WHATSAPP body closed a trailing {{if}} block in a bare
-- variable ({{shopName}} / {{trackingUrl}} / {{reviewUrl}}), which expands
-- to a terminal {{n}}.
--
-- Repair in place: insert a literal "." after the variable inside any
-- conditional block that can terminate the expanded body — i.e. the
-- block is last, or is followed ONLY by complete {{if}}…{{endif}}
-- blocks (which may expand to nothing and make it terminal) plus
-- whitespace. Any literal text after the block — e.g. `&utm_source=…`
-- continuing a tracking link — forbids the edit: the variable can
-- never land at the end and a stray "." would corrupt the URL.
-- The same repair applies to shop-customized bodies with the same
-- defect. IN_APP templates never reach Meta and are excluded.
UPDATE "notification_templates"
SET body = regexp_replace(
  body,
  '(\{\{\w+\}\})(\{\{endif\}\})(([[:space:]]*\{\{if[^{}]*\}\}((?!\{\{endif\}\}).)*?\{\{endif\}\})*[[:space:]]*$)',
  '\1.\2\3',
  'g'
)
WHERE channel = 'WHATSAPP'
  AND body ~ '\{\{\w+\}\}\{\{endif\}\}([[:space:]]*\{\{if[^{}]*\}\}((?!\{\{endif\}\}).)*?\{\{endif\}\})*[[:space:]]*$';
