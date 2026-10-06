import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const LOCALES_DIR = path.join(process.cwd(), "src/i18n/locales");
const EN_PATH = path.join(LOCALES_DIR, "en.json");
const SCAN_DIRS = ["src", "server", "shared"].map((d) =>
  path.join(process.cwd(), d)
);

interface DynamicKey {
  file: string;
  line: number;
  text: string;
}

function flattenKeys(obj: any, prefix = ""): string[] {
  let keys: string[] = [];
  for (const k in obj) {
    if (Object.hasOwn(obj, k)) {
      if (typeof obj[k] === "object" && obj[k] !== null) {
        keys = keys.concat(flattenKeys(obj[k], `${prefix}${k}.`));
      } else {
        keys.push(`${prefix}${k}`);
      }
    }
  }
  return keys;
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
  console.log("🔍 Starting AST-based i18n Translation Audit...\n");

  // 1. Read and flatten en.json keys
  let enContent = "";
  try {
    enContent = await fs.readFile(EN_PATH, "utf-8");
  } catch (error) {
    console.error(`❌ Failed to read en.json at ${EN_PATH}:`, error);
    process.exit(1);
  }

  const enJson = JSON.parse(enContent);
  const existingKeys = new Set(flattenKeys(enJson));
  console.log(`ℹ️ Loaded ${existingKeys.size} valid translation keys from en.json.`);

  // 2. Locate all .ts and .tsx files (client, server and shared code)
  const allFiles = (await Promise.all(SCAN_DIRS.map(getFiles))).flat();
  const tsFiles = allFiles.filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes("__tests__") && !f.includes("i18n/config.ts")
  );
  console.log(`ℹ️ Found ${tsFiles.length} TypeScript source files to scan.`);

  const keysInCode = new Map<string, Set<string>>(); // key -> set of files where it is used
  const fileContents = new Map<string, string>(); // for the literal-usage pass
  const dynamicKeys: DynamicKey[] = [];
  // Prefixes under which keys are resolved dynamically at runtime. Template
  // heads like `status.${x}` are collected automatically below; this seed list
  // covers keys produced outside t() (error codes, role/status maps, server
  // validation keys resolved via resolveValidationMessage).
  const dynamicPrefixes = new Set([
    "status.",
    "jobStatus.",
    "validations.",
    "errors.",
    "role.",
    "payment_method.",
    "part_category.",
    "repair_category.",
    "parts_board.",
    "tradeins.",
    "market_prices.",
    "quotes.status.",
    "tech_dashboard.",
    "front_desk.alert_",
    "intake.accessory_",
    "intake.check_",
    "profile_activity_",
    "jobs_history_action_",
    "returns_outcome_",
    "returns_status_",
    "returns_fault_",
    "parts_movement_",
    "ai_agent_prompt_",
  ]);

  // 3. Parse and walk AST of each file
  for (const filePath of tsFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const content = await fs.readFile(filePath, "utf-8");
    fileContents.set(relativePath, content);

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        // Check if function call is "t"
        if (ts.isIdentifier(expression) && expression.text === "t") {
          const arg = node.arguments[0];
          if (arg) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(arg.getStart());
            const lineNumber = line + 1;

            if (ts.isStringLiteral(arg)) {
              const key = arg.text;
              if (!keysInCode.has(key)) {
                keysInCode.set(key, new Set());
              }
              keysInCode.get(key)!.add(`${relativePath}:${lineNumber}`);
            } else if (ts.isNoSubstitutionTemplateLiteral(arg)) {
              const key = arg.text;
              if (!keysInCode.has(key)) {
                keysInCode.set(key, new Set());
              }
              keysInCode.get(key)!.add(`${relativePath}:${lineNumber}`);
            } else {
              // Dynamic key / expression template literal (e.g. t(`status.${s}`)).
              // The template head ("status.") is a dynamic prefix — any locale
              // key under it counts as used.
              if (ts.isTemplateExpression(arg)) {
                const head = arg.head.text.trim();
                if (head.length > 0) dynamicPrefixes.add(head);
              }
              dynamicKeys.push({
                file: relativePath,
                line: lineNumber,
                text: arg.getText(sourceFile),
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  // 4. Analyze results
  const missingKeys = new Map<string, Set<string>>();
  for (const [key, locations] of keysInCode.entries()) {
    if (!existingKeys.has(key)) {
      missingKeys.set(key, locations);
    }
  }

  // To find unused keys, we check which existingKeys are not in keysInCode.
  // Dynamic prefixes (template heads + the seed list above) are skipped —
  // they resolve at runtime.
  const unusedKeys: string[] = [];

  const allContent = [...fileContents.values()].join("\n");
  for (const key of existingKeys) {
    if (!keysInCode.has(key)) {
      const isDynamicCandidate = [...dynamicPrefixes].some((prefix) =>
        key.startsWith(prefix)
      );
      if (isDynamicCandidate) continue;
      // Keys can be passed to t() through variables — e.g. error codes stored
      // in state then translated. A quoted literal anywhere in code counts
      // as a use.
      const literal = new RegExp(
        `['"\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]`
      );
      if (!literal.test(allContent)) unusedKeys.push(key);
    }
  }

  // 5. Output Report
  console.log("\n==================================================");
  console.log("🚨 METRICS SUMMARY");
  console.log("==================================================");
  console.log(`Total Keys in Code (Static): ${keysInCode.size}`);
  console.log(`Missing Keys Identified:     ${missingKeys.size}`);
  console.log(`Unused Keys Identified:      ${unusedKeys.length}`);
  console.log(`Dynamic Key References:      ${dynamicKeys.length}`);
  console.log("==================================================\n");

  if (missingKeys.size > 0) {
    console.log("🚨 MISSING TRANSLATION KEYS FOUND!");
    console.log("--------------------------------------------------");
    for (const [key, locations] of missingKeys.entries()) {
      console.log(`• Key: "${key}"`);
      for (const loc of locations) {
        console.log(`    ↳ Used at: ${loc}`);
      }
    }
    console.log("--------------------------------------------------\n");
  } else {
    console.log("✅ No missing translation keys detected!\n");
  }

  if (unusedKeys.length > 0) {
    console.log("🗑️ UNUSED/DEAD TRANSLATION KEYS FOUND!");
    console.log("(Keys defined in en.json but never statically referenced in code)");
    console.log("--------------------------------------------------");
    for (const key of unusedKeys.sort()) {
      console.log(`• "${key}"`);
    }
    console.log("--------------------------------------------------\n");
  } else {
    console.log("✅ No unused translation keys detected!\n");
  }

  if (dynamicKeys.length > 0) {
    console.log("⚠️ DYNAMIC KEY REFERENCES ENCOUNTERED");
    console.log("(Verify these are handled properly via dynamic runtime mapping objects)");
    console.log("--------------------------------------------------");
    for (const dk of dynamicKeys) {
      console.log(`• At: ${dk.file}:${dk.line}`);
      console.log(`    ↳ Code: t(${dk.text})`);
    }
    console.log("--------------------------------------------------\n");
  }

  if (missingKeys.size > 0) {
    process.exit(1);
  } else {
    console.log("🎉 Translation audit complete and perfectly clean!");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error running scanner:", error);
  process.exit(1);
});
