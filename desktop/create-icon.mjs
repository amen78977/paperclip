/** Create a proper Windows multi-resolution ICO from Paperclip's own 512px logo. */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const requireFromServer = createRequire(path.join(root, "server", "package.json"));
const sharp = requireFromServer("sharp");
const source = path.join(root, "ui", "public", "android-chrome-512x512.png");
const destination = path.join(root, "desktop", "launcher", "assets", "app.ico");
const sizes = [256, 128, 64, 48, 32, 16];
const pngs = [];
for (const size of sizes) pngs.push(await sharp(source).resize(size, size).png().toBuffer());
const headerSize = 6 + 16 * sizes.length;
const icon = Buffer.alloc(headerSize + pngs.reduce((size, png) => size + png.length, 0));
icon.writeUInt16LE(0, 0);
icon.writeUInt16LE(1, 2);
icon.writeUInt16LE(sizes.length, 4);
let offset = headerSize;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  icon.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], entry);
  icon.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], entry + 1);
  icon.writeUInt8(0, entry + 2);
  icon.writeUInt8(0, entry + 3);
  icon.writeUInt16LE(1, entry + 4);
  icon.writeUInt16LE(32, entry + 6);
  icon.writeUInt32LE(pngs[i].length, entry + 8);
  icon.writeUInt32LE(offset, entry + 12);
  pngs[i].copy(icon, offset);
  offset += pngs[i].length;
}
writeFileSync(destination, icon);
console.log(`Created ${destination} (${icon.length} bytes, ${sizes.join("/")}px)`);
