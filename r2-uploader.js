import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, resolve, extname } from "node:path";

const WRANGLER_CONFIG_PATH = process.env.WRANGLER_CONFIG_PATH || "/home/ggg/.config/.wrangler/config/default.toml";
const CLOUD_STORAGE_JSON = process.env.CLOUD_STORAGE_JSON || "/home/ggg/vibes/workflow-video/config/cloud_storage.json";
const CLIENT_ID = "54d11594-84e4-41aa-b438-e81b8fa78ee7";

export async function getValidCloudflareToken() {
  if (!existsSync(WRANGLER_CONFIG_PATH)) {
    throw new Error(`Config file wrangler non trovato: ${WRANGLER_CONFIG_PATH}`);
  }

  const content = readFileSync(WRANGLER_CONFIG_PATH, "utf-8");
  const tokenMatch = content.match(/oauth_token\s*=\s*"([^"]+)"/);
  const refreshMatch = content.match(/refresh_token\s*=\s*"([^"]+)"/);
  const expiryMatch = content.match(/expiration_time\s*=\s*"([^"]+)"/);

  const oauthToken = tokenMatch?.[1];
  const refreshToken = refreshMatch?.[1];
  const expiry = expiryMatch?.[1] ? new Date(expiryMatch[1]) : new Date(0);

  // If expiring in less than 5 mins or expired, refresh token
  if (Date.now() > expiry.getTime() - 5 * 60 * 1000 && refreshToken) {
    console.log("[R2] Refreshing Cloudflare OAuth token...");
    try {
      const res = await fetch("https://dash.cloudflare.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
        let updated = content.replace(/oauth_token\s*=\s*"[^"]+"/, `oauth_token = "${data.access_token}"`);
        updated = updated.replace(/refresh_token\s*=\s*"[^"]+"/, `refresh_token = "${data.refresh_token}"`);
        updated = updated.replace(/expiration_time\s*=\s*"[^"]+"/, `expiration_time = "${newExpiry}"`);
        writeFileSync(WRANGLER_CONFIG_PATH, updated, "utf-8");
        return data.access_token;
      }
    } catch (e) {
      console.warn("[R2] Failed to refresh token, falling back to existing token:", e.message);
    }
  }

  if (oauthToken) return oauthToken;
  throw new Error("Impossibile recuperare il token Cloudflare OAuth.");
}

function getContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".mp4":
      return "video/mp4";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

export async function uploadToR2(localFilePath, remoteFolder = "gflow") {
  const filePath = resolve(localFilePath);
  if (!existsSync(filePath)) {
    throw new Error(`File da caricare su R2 non trovato: ${filePath}`);
  }

  let cloudCfg = {
    bucket_name: "video-workflow",
    public_url_base: "https://pub-1eccb9d654364b5d9e7545e3ebad5469.r2.dev",
  };

  if (existsSync(CLOUD_STORAGE_JSON)) {
    try {
      cloudCfg = JSON.parse(readFileSync(CLOUD_STORAGE_JSON, "utf-8"));
    } catch (e) {
      console.warn("[R2] Impossibile leggere cloud_storage.json, uso configurazione di default");
    }
  }

  const token = await getValidCloudflareToken();
  const fileName = basename(filePath);
  const remoteKey = `${remoteFolder}/${fileName}`;
  const contentType = getContentType(filePath);

  console.log(`[R2] Uploading to ${cloudCfg.bucket_name}/${remoteKey} (${contentType})...`);

  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(
      "wrangler",
      [
        "r2",
        "object",
        "put",
        `${cloudCfg.bucket_name}/${remoteKey}`,
        "--file",
        filePath,
        "--content-type",
        contentType,
        "--remote",
      ],
      {
        env: { ...process.env, CLOUDFLARE_API_TOKEN: token },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        const publicUrl = `${cloudCfg.public_url_base.replace(/\/$/, "")}/${remoteKey}`;
        console.log(`[R2] Upload success: ${publicUrl}`);
        resolvePromise(publicUrl);
      } else {
        rejectPromise(new Error(`Wrangler R2 upload failed (exit code ${code}):\n${stderr}`));
      }
    });
  });
}
