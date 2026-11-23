-- Meta rejects a message template whose BODY starts or ends with a
-- positional parameter — the submission never reaches review, which left
-- job-done, quote and signature notifications unsendable in cloud mode.
-- Every seeded WHATSAPP body closed a trailing {{if}} block in a bare
-- variable ({{shopName}} / {{trackingUrl}} / {{reviewUrl}}), which expands
-- to a terminal {{n}}.
--
-- Repair in place: insert a literal "." after the variable inside any
-- conditional block that can terminate the expanded body — i.e. the
-- block is last, or is followed only by another {{if}} block (which may
-- expand to nothing and make it terminal). Blocks followed by literal
-- text are untouched. The same repair applies to shop-customized bodies
-- with the same defect: a stray "." inside a conditional beats a
-- guaranteed Meta rejection. IN_APP templates never reach Meta and are
-- excluded.
UPDATE "notification_templates"
SET body = regexp_replace(
  body,
  '(\{\{\w+\}\})(\{\{endif\}\})([[:space:]]*\{\{if|[[:space:]]*$)',
  '\1.\2\3',
  'g'
)
WHERE channel = 'WHATSAPP'
  AND body ~ '\{\{\w+\}\}\{\{endif\}\}([[:space:]]*\{\{if|[[:space:]]*$)';
