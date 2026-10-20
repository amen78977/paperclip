/** Fail CI if an upstream update accidentally removes the Arabic-first shell. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const required = [
  "ui/src/i18n/index.ts",
  "ui/src/i18n/interface-labels.ts",
  "ui/src/components/LanguageSwitcher.tsx",
  "ui/src/pages/Auth.tsx",
  "desktop/launcher/main.cjs",
];
for (const file of required) {
  if (!existsSync(path.join(root, file))) throw new Error(`Arabic edition missing required source: ${file}`);
}
const language = read("ui/src/i18n/index.ts");
if (!language.includes('DEFAULT_DESKTOP_LOCALE = "ar"') || !language.includes('"rtl"')) {
  throw new Error("Arabic language defaults or RTL handling disappeared during upstream update");
}
const html = read("ui/dist/index.html");
if (!html.includes('lang="ar"')) throw new Error("Built desktop frontend is not Arabic-first");
const locales = read("ui/src/i18n/interface-labels.ts");
if ((locales.match(/[\u0600-\u06FF]/g) ?? []).length < 100) {
  throw new Error("Arabic translations were removed or corrupted");
}
const assets = path.join(root, "ui", "dist", "assets");
if (!existsSync(assets) || readdirSync(assets).length < 10) throw new Error("No built web UI assets");
console.log("PASS: Arabic-first language, RTL, language selector, translations and compiled UI are preserved");
