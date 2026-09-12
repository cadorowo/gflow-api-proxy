import http from "node:http";
import { existsSync, createReadStream, statSync, readFileSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import os from "node:os";
import { QueueManager } from "./queue-manager.js";
import { findGflowBinary, cleanProfileLocks, checkAuthStatus } from "./gflow-runner.js";

// Load .env if present
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

const PORT = parseInt(process.env.PORT || "1235", 10);
const STORAGE_DIR = resolve(process.env.STORAGE_DIR || join(process.cwd(), "storage"));
const DEFAULT_PROFILE = process.env.GFLOW_DEFAULT_PROFILE || "giovannidegattis";
const GFLOW_API_KEY = process.env.GFLOW_API_KEY || null;

const queue = new QueueManager({ storageDir: STORAGE_DIR });

// Authentication middleware
function checkAuth(req, res) {
  if (!GFLOW_API_KEY) return true;
  const authHeader = req.headers["authorization"] || "";
  const apiKeyHeader = req.headers["x-api-key"] || "";
  
  let providedKey = null;
  if (authHeader.startsWith("Bearer ")) {
    providedKey = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader.trim();
  }

  if (providedKey && providedKey === GFLOW_API_KEY) {
    return true;
  }

  // Allow localhost without key ONLY if no external forwarded header exists
  const remoteIp = req.socket.remoteAddress;
  const isLocal = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
  if (isLocal && !req.headers["x-forwarded-for"] && !req.headers["cf-connecting-ip"]) {
    return true;
  }

  sendError(res, 401, "Unauthorized: Invalid or missing API Key. Use 'Authorization: Bearer <key>' or 'x-api-key: <key>'.", "unauthorized");
  return false;
}

// Detect Tailscale IP or primary IP
function getNetworkIps() {
  const nets = os.networkInterfaces();
  let tailscaleIp = null;
  let localIp = "127.0.0.1";

  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        if (name.includes("tailscale") || addr.address.startsWith("100.")) {
          tailscaleIp = addr.address;
        } else if (!localIp || localIp === "127.0.0.1") {
          localIp = addr.address;
        }
      }
    }
  }

  return {
    local: "127.0.0.1",
    lan: localIp,
    tailscale: tailscaleIp || localIp,
  };
}

const networkIps = getNetworkIps();
const PRIMARY_REMOTE_IP = networkIps.tailscale || networkIps.lan;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, statusCode, message, type = "invalid_request_error") {
  console.error(`[HTTP ${statusCode}] ${type}: ${message}`);
  sendJson(res, statusCode, {
    error: {
      message,
      type,
      code: statusCode,
    },
  });
}

function parseJsonBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!body.trim()) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(body));
      } catch (err) {
        rejectPromise(new Error("Invalid JSON in request body"));
      }
    });
    req.on("error", rejectPromise);
  });
}

function buildResultPayload(result, taskId) {
  const filename = result.filename;
  const localUrl = `http://localhost:${PORT}/media/${filename}`;
  const remoteUrl = `http://${PRIMARY_REMOTE_IP}:${PORT}/media/${filename}`;

  return {
    success: true,
    task_id: taskId,
    filename,
    local_path: result.localPath,
    media_url: localUrl,
    remote_url: remoteUrl,
    r2_url: result.r2Url || null,
    data_uri: result.dataUri || null,
    markdown_preview: result.isImage
      ? `![${filename}](${remoteUrl})`
      : `<video src="${remoteUrl}" controls width="100%"></video>`,
  };
}

// Static media server with HTTP Range support for video scrubbing
function handleMediaStream(req, res, filename) {
  const filePath = join(STORAGE_DIR, filename);
  if (!existsSync(filePath)) {
    return sendError(res, 404, `File '${filename}' not found in storage`, "not_found");
  }

  const stat = statSync(filePath);
  const fileSize = stat.size;
  const ext = extname(filePath).toLowerCase();

  let contentType = "application/octet-stream";
  if (ext === ".mp4") contentType = "video/mp4";
  else if (ext === ".png") contentType = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
  else if (ext === ".webp") contentType = "image/webp";

  if (req.method === "HEAD") {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    return res.end();
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.writeHead(416, {
        "Content-Range": `bytes */${fileSize}`,
      });
      return res.end();
    }

    const chunksize = end - start + 1;
    const file = createReadStream(filePath, { start, end });
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  // 1. Health & Server Info
  if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/health" || pathname === "/")) {
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end();
    }
    return sendJson(res, 200, {
      status: "ok",
      service: "gflow-api-proxy",
      version: "1.0.0",
      auth_enabled: Boolean(GFLOW_API_KEY),
      gflow_bin: findGflowBinary(),
      default_profile: DEFAULT_PROFILE,
      profiles: queue.getProfilesStatus(),
      network: {
        port: PORT,
        local_host: `http://localhost:${PORT}`,
        remote_host: `http://${PRIMARY_REMOTE_IP}:${PORT}`,
        tailscale_ip: networkIps.tailscale,
      },
      storage_dir: STORAGE_DIR,
    });
  }

  // 2. Models
  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/v1/models") {
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end();
    }
    return sendJson(res, 200, {
      object: "list",
      data: [
        { id: "omni-flash", object: "model", type: "video", default: true },
        { id: "veo-2", object: "model", type: "video" },
        { id: "nano-pro", object: "model", type: "image", default: true },
        { id: "nano2", object: "model", type: "image" },
        { id: "image4", object: "model", type: "image" },
      ],
    });
  }

  // 3. Static Media Streaming
  if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/media/")) {
    const filename = pathname.replace("/media/", "");
    return handleMediaStream(req, res, filename);
  }

  // 4. Task Polling
  if (req.method === "GET" && pathname.startsWith("/v1/tasks/")) {
    const taskId = pathname.replace("/v1/tasks/", "");
    const task = queue.getTask(taskId);
    if (!task) {
      return sendError(res, 404, `Task '${taskId}' not found`, "not_found");
    }
    return sendJson(res, 200, {
      task,
      urls: task.result ? buildResultPayload(task.result, taskId) : null,
    });
  }

  if (req.method === "GET" && pathname === "/v1/tasks") {
    return sendJson(res, 200, { tasks: queue.listTasks() });
  }

  // 5. Maintenance
  if (req.method === "POST" && pathname === "/v1/maintenance/clean-locks") {
    if (!checkAuth(req, res)) return;
    const body = await parseJsonBody(req).catch(() => ({}));
    const profile = body.profile || DEFAULT_PROFILE;
    cleanProfileLocks(profile);
    return sendJson(res, 200, { status: "cleaned", profile });
  }

  if (req.method === "POST" && pathname === "/v1/auth/verify") {
    if (!checkAuth(req, res)) return;
    const body = await parseJsonBody(req).catch(() => ({}));
    const profile = body.profile || DEFAULT_PROFILE;
    const auth = await checkAuthStatus(profile);
    if (auth.verified) {
      queue.resetProfileAuth(profile);
    }
    return sendJson(res, auth.verified ? 200 : 401, auth);
  }

  // 6. Generations Endpoints (T2V, I2V, T2I, I2I)
  if (req.method === "POST") {
    if (!checkAuth(req, res)) return;
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return sendError(res, 400, err.message, "invalid_request_error");
    }

    const wait = body.wait !== false; // default: true (synchronous wait)
    let taskParams = null;

    if (pathname === "/v1/video/t2v") {
      if (!body.prompt) return sendError(res, 400, "Missing required field: 'prompt'");
      taskParams = {
        type: "video_t2v",
        prompt: body.prompt,
        model: body.model || "omni-flash",
        aspect: body.aspect || "9:16",
        projectId: body.project_id || body.projectId,
        profile: body.profile,
        uploadR2: Boolean(body.upload_r2 || body.uploadR2),
      };
    } else if (pathname === "/v1/video/i2v") {
      if (!body.prompt) return sendError(res, 400, "Missing required field: 'prompt'");
      if (!body.initial_frame && !body.initialFrame) {
        return sendError(res, 400, "Missing required field: 'initial_frame'");
      }
      taskParams = {
        type: "video_i2v",
        prompt: body.prompt,
        initialFrame: body.initial_frame || body.initialFrame,
        model: body.model,
        aspect: body.aspect || "9:16",
        projectId: body.project_id || body.projectId,
        profile: body.profile,
        uploadR2: Boolean(body.upload_r2 || body.uploadR2),
      };
    } else if (pathname === "/v1/image/t2i") {
      if (!body.prompt) return sendError(res, 400, "Missing required field: 'prompt'");
      taskParams = {
        type: "image_t2i",
        prompt: body.prompt,
        model: body.model || "nano-pro",
        aspect: body.aspect || "1:1",
        count: body.count || 1,
        projectId: body.project_id || body.projectId,
        profile: body.profile,
        uploadR2: Boolean(body.upload_r2 || body.uploadR2),
      };
    } else if (pathname === "/v1/image/i2i") {
      if (!body.prompt) return sendError(res, 400, "Missing required field: 'prompt'");
      const refs = body.references || (body.reference ? [body.reference] : []);
      if (refs.length === 0) {
        return sendError(res, 400, "Missing required field: 'references' (array of file paths or UUIDs)");
      }
      taskParams = {
        type: "image_i2i",
        prompt: body.prompt,
        references: refs,
        model: body.model || "image4",
        aspect: body.aspect || "1:1",
        projectId: body.project_id || body.projectId,
        profile: body.profile,
        uploadR2: Boolean(body.upload_r2 || body.uploadR2),
      };
    } else if (pathname === "/v1/images/generations") {
      // OpenAI-compatible endpoint
      if (!body.prompt) return sendError(res, 400, "Missing required field: 'prompt'");
      let aspect = "1:1";
      if (body.size === "1024x1792" || body.size === "768x1344") aspect = "9:16";
      else if (body.size === "1792x1024" || body.size === "1344x768") aspect = "16:9";

      taskParams = {
        type: "image_t2i",
        prompt: body.prompt,
        model: body.model || "nano-pro",
        aspect,
        count: body.n || 1,
        projectId: body.project_id,
        profile: body.profile,
        uploadR2: Boolean(body.upload_r2),
        isOpenAiFormat: true,
      };
    }

    if (taskParams) {
      try {
        const { taskId, taskRecord, completionPromise } = queue.enqueue(taskParams);

        if (!wait) {
          completionPromise.catch((err) => { console.warn("[QueueManager] Async task rejected:", err.message); });
          return sendJson(res, 202, {
            task_id: taskId,
            status: "pending",
            profile: taskRecord.profile,
            poll_url: `http://${PRIMARY_REMOTE_IP}:${PORT}/v1/tasks/${taskId}`,
          });
        }

        const result = await completionPromise;

        if (taskParams.isOpenAiFormat) {
          const payload = buildResultPayload(result, taskId);
          return sendJson(res, 200, {
            created: Math.floor(Date.now() / 1000),
            data: [
              {
                url: payload.remote_url,
                b64_json: result.dataUri ? result.dataUri.split(",")[1] : undefined,
              },
            ],
          });
        }

        const payload = buildResultPayload(result, taskId);
        return sendJson(res, 200, payload);
      } catch (err) {
        const status = err.statusCode || (err.isAuthError ? 401 : 500);
        return sendError(res, status, err.message, err.isAuthError ? "auth_error" : "generation_error");
      }
    }
  }

  return sendError(res, 404, `Endpoint ${req.method} ${pathname} not found`, "not_found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`=======================================================`);
  console.log(`🚀 gflow-api-proxy running on port ${PORT}`);
  console.log(`- Local URL: http://localhost:${PORT}`);
  console.log(`- Remote URL (Tailscale): http://${PRIMARY_REMOTE_IP}:${PORT}`);
  console.log(`- Default Profile: ${DEFAULT_PROFILE}`);
  console.log(`- Storage Dir: ${STORAGE_DIR}`);
  console.log(`- Health Check: http://localhost:${PORT}/health`);
  console.log(`- Video T2V: POST http://localhost:${PORT}/v1/video/t2v`);
  console.log(`- Image T2I: POST http://localhost:${PORT}/v1/image/t2i`);
  console.log(`- OpenAI Drop-in: POST http://localhost:${PORT}/v1/images/generations`);
  console.log(`=======================================================`);
});
