const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const i = trimmed.indexOf("=");
  if (i < 0) continue;
  let value = trimmed.slice(i + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env[trimmed.slice(0, i).trim()] = value;
}

const blob = [process.env.DATABASE_URL, process.env.SUPABASE_PROJECT_URL].join(" ");
console.log(
  JSON.stringify(
    {
      uatRef: blob.includes("rzvayccekcmkpwfyxuzi"),
      prodRefAbsent: !blob.includes("qaqmseqfotymmwkmzjsp"),
      head: execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(),
      migrateStatus: execSync("npx prisma migrate status", { cwd: root, encoding: "utf8" }),
    },
    null,
    2,
  ),
);
