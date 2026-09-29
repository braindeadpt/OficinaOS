import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const SRC_DIR = path.join(process.cwd(), "src");
const UI_DIR = path.join(SRC_DIR, "components", "ui");

/**
 * Form controls the design system provides in src/components/ui. Writing them
 * by hand is what produced the visual drift this budget exists to stop: no
 * shared id wiring, no aria-describedby for hints or errors, and every screen
 * free to invent its own label typography and spacing.
 *
 * Buttons are deliberately out of scope. 323 of them are written by hand and
 * most are navigation, icon toggles and table cells that the Button primitive
 * cannot express (it has no asChild), so a button budget would be too loose to
 * catch anything. Migrating them is its own project; this guard targets the
 * controls where Field actually helps.
 */
const PRIMITIVE_TAGS = ["input", "textarea", "select", "label"] as const;
type PrimitiveTag = (typeof PRIMITIVE_TAGS)[number];

/**
 * Ceiling per element, exclusive of src/components/ui. These are ratchets, not
 * targets: the check fails the moment a count goes over the number below, so
 * removing a raw control lowers the ceiling in the same commit that removes
 * it. Drive every number to zero to retire the corresponding rule.
 */
const BUDGET: Record<PrimitiveTag, number> = {
  input: 78,
  label: 71,
  select: 13,
  textarea: 15,
};

interface Offence {
  file: string;
  line: number;
  tag: PrimitiveTag;
}

async function getFiles(dir: string): Promise<string[]> {
  const subdirs = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    subdirs.map(async (subdir) => {
      const res = path.resolve(dir, subdir.name);
      return subdir.isDirectory() ? getFiles(res) : res;
    })
  );
  return files.flat();
}

async function main() {
  const allFiles = await getFiles(SRC_DIR);
  const sourceFiles = allFiles.filter(
    (f) =>
      (f.endsWith(".tsx") || f.endsWith(".ts")) &&
      !f.includes("__tests__") &&
      !f.endsWith(".d.ts")
  );

  const counts = Object.fromEntries(
    PRIMITIVE_TAGS.map((t) => [t, 0])
  ) as Record<PrimitiveTag, number>;
  const byFile = new Map<string, Offence[]>();

  for (const file of sourceFiles) {
    if (file.startsWith(UI_DIR + path.sep)) {
      continue;
    }
    const source = await fs.readFile(file, "utf-8");
    const relative = path.relative(process.cwd(), file);
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const visit = (node: ts.Node) => {
      if (
        ts.isJsxSelfClosingElement(node) ||
        ts.isJsxOpeningElement(node) ||
        ts.isJsxClosingElement(node)
      ) {
        const tag = node.tagName.getText(sourceFile);
        if (
          (PRIMITIVE_TAGS as readonly string[]).includes(tag) &&
          // A closing tag is the same element as its opener; count it once.
          !ts.isJsxClosingElement(node)
        ) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile)
          );
          const offence: Offence = {
            file: relative,
            line: line + 1,
            tag: tag as PrimitiveTag,
          };
          counts[tag as PrimitiveTag] += 1;
          const list = byFile.get(relative) ?? [];
          list.push(offence);
          byFile.set(relative, list);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const over = PRIMITIVE_TAGS.filter((tag) => counts[tag] > BUDGET[tag]);

  for (const tag of PRIMITIVE_TAGS) {
    const mark = counts[tag] > BUDGET[tag] ? "❌" : "✔";
    console.log(
      `  ${mark} <${tag}>: ${counts[tag]} / ${BUDGET[tag]} allowed`
    );
  }

  if (over.length > 0) {
    console.error("\n❌ Raw form controls crept past their ratchet budget.\n");
    for (const tag of over) {
      console.error(
        `  <${tag}> budget is ${BUDGET[tag]}, found ${counts[tag]}.`
      );
    }
    console.error(
      "\nUse Input, Textarea, Select, Label or Field from src/components/ui.\n"
    );
    process.exit(1);
  }

  const worst = [...byFile.entries()]
    .map(([file, list]) => [file, list.length] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log("\n🎉 No raw form control exceeded its ratchet budget.");
  console.log("   Heaviest files still to migrate:");
  for (const [file, n] of worst) {
    console.log(`     ${n}  ${file}`);
  }
  console.log("");
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Unexpected error running the primitive check:", error);
  process.exit(1);
});
