const fs = require("fs/promises");
const path = require("path");

const pool = require("../db");
const { importAdminConfig } = require("../services/adminConfigService");

const defaultConfigPath = path.resolve(
  __dirname,
  "../../admin/Kaptaan-Dashboard/src/public/cms-data.json",
);

async function main() {
  const targetPath = path.resolve(process.argv[2] || defaultConfigPath);
  const raw = await fs.readFile(targetPath, "utf8");
  const payload = JSON.parse(raw);

  const result = await importAdminConfig(payload, null);

  console.log("Imported admin config successfully.");
  console.log(`Source: ${targetPath}`);
  console.log(`Post types: ${result.config?.post_types?.length || 0}`);
  console.log(`Taxonomies: ${result.config?.taxonomies?.length || 0}`);
  console.log(`User roles: ${result.config?.users?.role?.length || 0}`);
  console.log(`User meta keys: ${result.config?.users?.meta_keys?.length || 0}`);
  console.log(`Review meta keys: ${result.config?.reviews?.meta_keys?.length || 0}`);
}

main()
  .catch((error) => {
    console.error("Failed to import admin config:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
