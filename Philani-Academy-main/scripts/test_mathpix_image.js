const fs = require("fs");
const path = require("path");

const imageUrl = "https://mathpix-ocr-examples.s3.amazonaws.com/cases_hw.jpg";

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const workspaceRoot = path.resolve(__dirname, "..");
loadEnvFromFile(path.join(workspaceRoot, ".env.local"));
loadEnvFromFile(path.join(workspaceRoot, ".env"));

const appId = process.env.MATHPIX_APP_ID;
const appKey = process.env.MATHPIX_APP_KEY;

if (!appId || !appKey) {
  console.error("Missing MATHPIX_APP_ID or MATHPIX_APP_KEY in environment or .env.local.");
  process.exit(1);
}

async function run() {
  const payload = {
    src: imageUrl,
    formats: ["text", "latex_styled"],
    rm_spaces: true
  };

  const response = await fetch("https://api.mathpix.com/v3/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "app_id": appId,
      "app_key": appKey
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  console.log("Status:", response.status);
  console.log("Response:");
  console.log(text);
}

run().catch((error) => {
  console.error("Request failed:", error);
  process.exit(1);
});
