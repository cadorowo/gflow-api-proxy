import crypto from "node:crypto";
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import os from "node:os";
import { runGflowCommand } from "./gflow-runner.js";

const GFLOW_SHARE_DIR = resolve(os.homedir(), ".local/share/gflow-cli");

export class QueueManager {
  constructor(options = {}) {
    this.storageDir = options.storageDir || resolve(process.cwd(), "storage");
    this.profiles = new Map(); // profileName -> { queue: [], running: false, state: 'healthy'|'error_auth', lastError: null }
    this.tasks = new Map(); // taskId -> taskRecord
    this.taskHistoryLimit = options.taskHistoryLimit || 100;

    this.discoverProfiles();
  }

  discoverProfiles() {
    if (existsSync(GFLOW_SHARE_DIR)) {
      try {
        const entries = readdirSync(GFLOW_SHARE_DIR);
        for (const entry of entries) {
          if (entry.startsWith("profile_")) {
            const name = entry.replace("profile_", "");
            this.registerProfile(name);
          }
        }
      } catch (e) {
        console.warn("[QueueManager] Error scanning profiles:", e.message);
      }
    }

    if (this.profiles.size === 0) {
      this.registerProfile("giovannidegattis");
    }

    console.log(`[QueueManager] Registered profile pool:`, Array.from(this.profiles.keys()));
  }

  registerProfile(profileName) {
    if (!this.profiles.has(profileName)) {
      this.profiles.set(profileName, {
        queue: [],
        running: false,
        state: "healthy",
        lastError: null,
      });
    }
  }

  getProfilesStatus() {
    const list = [];
    for (const [name, p] of this.profiles.entries()) {
      list.push({
        profile: name,
        running: p.running,
        queued: p.queue.length,
        state: p.state,
        lastError: p.lastError,
      });
    }
    return list;
  }

  selectProfile(requestedProfile) {
    if (requestedProfile) {
      this.registerProfile(requestedProfile);
      return requestedProfile;
    }

    // Pick first idle healthy profile, or profile with shortest queue
    let candidate = null;
    let minQueue = Infinity;

    for (const [name, p] of this.profiles.entries()) {
      if (p.state !== "healthy") continue;
      if (!p.running && p.queue.length === 0) {
        return name;
      }
      if (p.queue.length < minQueue) {
        minQueue = p.queue.length;
        candidate = name;
      }
    }

    return candidate || Array.from(this.profiles.keys())[0] || "giovannidegattis";
  }

  enqueue(taskParams) {
    const taskId = `task_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const targetProfile = this.selectProfile(taskParams.profile);
    const profileEntry = this.profiles.get(targetProfile);

    if (profileEntry.state === "error_auth") {
      const err = new Error(
        `Profile '${targetProfile}' is in error_auth state. Please run 'gflow auth login --profile ${targetProfile}' to re-authenticate.`
      );
      err.statusCode = 401;
      throw err;
    }

    const taskRecord = {
      id: taskId,
      profile: targetProfile,
      type: taskParams.type,
      prompt: taskParams.prompt,
      model: taskParams.model,
      aspect: taskParams.aspect,
      count: taskParams.count || 1,
      projectId: taskParams.projectId,
      uploadR2: Boolean(taskParams.uploadR2),
      status: "pending", // pending | running | completed | failed
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };

    this.tasks.set(taskId, taskRecord);
    this._pruneHistory();

    const completionPromise = new Promise((resolvePromise, rejectPromise) => {
      const jobItem = {
        taskRecord,
        params: taskParams,
        resolve: resolvePromise,
        reject: rejectPromise,
      };

      profileEntry.queue.push(jobItem);
      this._processNext(targetProfile);
    });

    return {
      taskId,
      taskRecord,
      completionPromise,
    };
  }

  async _processNext(profileName) {
    const profileEntry = this.profiles.get(profileName);
    if (!profileEntry || profileEntry.running || profileEntry.queue.length === 0) {
      return;
    }

    const job = profileEntry.queue.shift();
    profileEntry.running = true;
    job.taskRecord.status = "running";
    job.taskRecord.startedAt = new Date().toISOString();

    console.log(`[QueueManager] [${profileName}] Starting task ${job.taskRecord.id} (${job.taskRecord.type})`);

    try {
      const result = await runGflowCommand({
        ...job.params,
        profile: profileName,
        outputDir: this.storageDir,
        uploadR2: job.taskRecord.uploadR2,
      });

      job.taskRecord.status = "completed";
      job.taskRecord.completedAt = new Date().toISOString();
      job.taskRecord.result = result;

      profileEntry.state = "healthy";
      profileEntry.lastError = null;

      job.resolve(result);
    } catch (err) {
      job.taskRecord.status = "failed";
      job.taskRecord.completedAt = new Date().toISOString();
      job.taskRecord.error = err.message;

      if (err.isAuthError) {
        console.error(`[QueueManager] [${profileName}] Auth expired! Purging queue fail-fast.`);
        profileEntry.state = "error_auth";
        profileEntry.lastError = err.message;

        // Drain pending queue for this profile
        while (profileEntry.queue.length > 0) {
          const pending = profileEntry.queue.shift();
          pending.taskRecord.status = "failed";
          pending.taskRecord.completedAt = new Date().toISOString();
          pending.taskRecord.error = "Aborted: profile session expired";
          const authErr = new Error(`Aborted: session expired on profile '${profileName}'`);
          authErr.statusCode = 401;
          pending.reject(authErr);
        }
      }

      job.reject(err);
    } finally {
      profileEntry.running = false;
      this._processNext(profileName);
    }
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  listTasks(limit = 20) {
    const all = Array.from(this.tasks.values());
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return all.slice(0, limit);
  }

  resetProfileAuth(profileName) {
    const profileEntry = this.profiles.get(profileName);
    if (profileEntry) {
      profileEntry.state = "healthy";
      profileEntry.lastError = null;
    }
  }

  _pruneHistory() {
    if (this.tasks.size > this.taskHistoryLimit) {
      const keysToDelete = Array.from(this.tasks.keys()).slice(0, this.tasks.size - this.taskHistoryLimit);
      for (const k of keysToDelete) {
        this.tasks.delete(k);
      }
    }
  }
}
