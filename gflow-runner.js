import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync, statSync } from "node:fs";
import { resolve, basename, extname, join } from "node:path";
import os from "node:os";
import { uploadToR2 } from "./r2-uploader.js";

const DEFAULT_PROFILE = process.env.GFLOW_DEFAULT_PROFILE || "giovannidegattis";
const DEFAULT_PROJECT_ID = process.env.GFLOW_DEFAULT_PROJECT_ID || "ef628878-e9bd-47af-82ac-b8584688e948";
const GFLOW_SHARE_DIR = resolve(os.homedir(), ".local/share/gflow-cli");

export function findGflowBinary() {
  const envBin = process.env.GFLOW_BIN;
  if (envBin && existsSync(envBin)) return envBin;

  const candidates = [
    "/home/ggg/.local/bin/gflow",
    "/home/ggg/.local/share/uv/tools/gflow-cli/bin/gflow",
    resolve(os.homedir(), ".local/bin/gflow"),
  ];

  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }

  return "gflow";
}

/**
 * Ensures clean environment before running Playwright on this profile.
 * Kills orphaned chrome processes for this profile and removes Singleton locks.
 */
export function cleanProfileLocks(profile = DEFAULT_PROFILE, killOrphans = true) {
  if (killOrphans) {
    try {
      execSync(`pkill -f profile_${profile} || true`, { stdio: "ignore" });
    } catch (e) {}
  }

  const profileDir = join(GFLOW_SHARE_DIR, `profile_${profile}`);
  if (!existsSync(profileDir)) return;

  try {
    const entries = readdirSync(profileDir);
    for (const entry of entries) {
      if (entry.startsWith("Singleton")) {
        try {
          unlinkSync(join(profileDir, entry));
          console.log(`[Cleaner] Removed lock: profile_${profile}/${entry}`);
        } catch (e) {}
      }
    }
  } catch (e) {
    console.warn(`[Cleaner] Could not scan ${profileDir}:`, e.message);
  }
}

/**
 * Checks session validity via `gflow auth status`.
 */
export async function checkAuthStatus(profile = DEFAULT_PROFILE) {
  const gflowBin = findGflowBinary();
  return new Promise((res) => {
    const proc = spawn(gflowBin, ["auth", "status", "--profile", profile], {
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0" },
    });

    let output = "";
    proc.stdout.on("data", (d) => (output += d.toString()));
    proc.stderr.on("data", (d) => (output += d.toString()));

    proc.on("close", (code) => {
      const verified = code === 0 && output.includes("Flow session verified");
      res({
        verified,
        exitCode: code,
        output: output.trim(),
      });
    });
  });
}

function imageFileToDataUri(filePath) {
  try {
    const ext = extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const data = readFileSync(filePath);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch (e) {
    return null;
  }
}

/**
 * Executes a gflow generation command.
 */
export async function runGflowCommand({
  type, // "video_t2v" | "video_i2v" | "image_t2i" | "image_i2i"
  prompt,
  model,
  aspect,
  count = 1,
  initialFrame,
  references = [],
  projectId = DEFAULT_PROJECT_ID,
  profile = DEFAULT_PROFILE,
  outputDir,
  uploadR2 = false,
  timeoutMs = 180000,
}) {
  const gflowBin = findGflowBinary();
  mkdirSync(outputDir, { recursive: true });

  cleanProfileLocks(profile);

  const timestamp = Date.now();
  const args = [];
  let expectedOutputFile = null;

  if (type === "video_t2v") {
    expectedOutputFile = join(outputDir, `gflow_video_${timestamp}.mp4`);
    args.push("video", "t2v", prompt);
    if (model) args.push("--model", model);
    if (aspect) args.push("--aspect", aspect);
    if (projectId) args.push("--project", projectId);
    if (profile) args.push("--profile", profile);
    args.push("-o", expectedOutputFile);
  } else if (type === "video_i2v") {
    expectedOutputFile = join(outputDir, `gflow_video_${timestamp}.mp4`);
    args.push("video", "i2v", "--initial-frame", initialFrame, prompt);
    if (model) args.push("--model", model);
    if (aspect) args.push("--aspect", aspect);
    if (projectId) args.push("--project", projectId);
    if (profile) args.push("--profile", profile);
    args.push("-o", expectedOutputFile);
  } else if (type === "image_t2i") {
    if (count === 1) {
      expectedOutputFile = join(outputDir, `gflow_image_${timestamp}.png`);
      args.push("image", "t2i", prompt);
      if (model) args.push("--model", model);
      if (aspect) args.push("--aspect", aspect);
      if (projectId) args.push("--project", projectId);
      if (profile) args.push("--profile", profile);
      args.push("-o", expectedOutputFile);
    } else {
      args.push("image", "t2i", prompt);
      if (model) args.push("--model", model);
      if (aspect) args.push("--aspect", aspect);
      args.push("-n", String(count));
      if (projectId) args.push("--project", projectId);
      if (profile) args.push("--profile", profile);
      args.push("--out", outputDir);
    }
  } else if (type === "image_i2i") {
    expectedOutputFile = join(outputDir, `gflow_image_${timestamp}.png`);
    args.push("image", "i2i", prompt);
    for (const ref of references) {
      args.push("--ref", ref);
    }
    if (model) args.push("--model", model);
    if (aspect) args.push("--aspect", aspect);
    if (projectId) args.push("--project", projectId);
    if (profile) args.push("--profile", profile);
    args.push("-o", expectedOutputFile);
  } else {
    throw new Error(`Unsupported generation type: ${type}`);
  }

  console.log(`[Runner] Spawning: ${gflowBin} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);

  const spawnEnv = {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ":0",
    GFLOW_CLI_HEADLESS: process.env.GFLOW_CLI_HEADLESS || "false",
  };

  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(gflowBin, args, {
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      const str = d.toString();
      stdout += str;
      process.stdout.write(`[gflow stdout] ${str}`);
    });

    proc.stderr.on("data", (d) => {
      const str = d.toString();
      stderr += str;
      process.stderr.write(`[gflow stderr] ${str}`);
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch (e) {}
        cleanProfileLocks(profile, true);
      }, 1500);
      rejectPromise(new Error(`Timeout exceeded (${timeoutMs / 1000}s) during gflow generation`));
    }, timeoutMs);

    proc.on("close", async (code) => {
      clearTimeout(timer);

      // Check for auth failure
      const isAuthError =
        code === 3 ||
        stderr.includes("AuthExpiredError") ||
        stderr.includes("Unauthorized") ||
        stderr.includes("No session for profile") ||
        stdout.includes("AuthExpiredError");

      if (isAuthError) {
        cleanProfileLocks(profile, true);
        const err = new Error(`Authentication error on profile '${profile}': Flow session expired or missing`);
        err.isAuthError = true;
        err.profile = profile;
        return rejectPromise(err);
      }

      if (code !== 0) {
        cleanProfileLocks(profile, true);
        return rejectPromise(
          new Error(`gflow exited with error code ${code}:\n${(stderr || stdout).trim()}`)
        );
      }

      // Collect generated file(s)
      let files = [];
      if (expectedOutputFile && existsSync(expectedOutputFile)) {
        files.push(expectedOutputFile);
      } else {
        // Find most recently created file in outputDir
        const allFiles = readdirSync(outputDir)
          .map((f) => join(outputDir, f))
          .filter((f) => statSync(f).isFile())
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        if (allFiles.length > 0) {
          files = allFiles.slice(0, count);
        }
      }

      if (files.length === 0) {
        return rejectPromise(new Error("gflow finished successfully but no output files were found"));
      }

      const primaryFile = files[0];
      const isImage = /\.(png|jpg|jpeg|webp)$/i.test(primaryFile);
      const filename = basename(primaryFile);

      let r2Url = null;
      if (uploadR2) {
        try {
          r2Url = await uploadToR2(primaryFile, type.startsWith("video") ? "twist-it" : "images");
        } catch (e) {
          console.warn("[Runner] R2 upload failed:", e.message);
        }
      }

      const dataUri = isImage ? imageFileToDataUri(primaryFile) : null;

      resolvePromise({
        success: true,
        filename,
        localPath: primaryFile,
        files,
        isImage,
        dataUri,
        r2Url,
        stdout: stdout.trim(),
      });
    });
  });
}
