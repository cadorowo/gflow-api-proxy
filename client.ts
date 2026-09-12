/**
 * gflow-api-proxy TypeScript / Bun Client
 */

export interface GflowGenerationOptions {
  proxyUrl?: string; // default: http://localhost:1235 or http://100.74.82.76:1235
  profile?: string;
  projectId?: string;
  wait?: boolean;
  uploadR2?: boolean;
}

export interface VideoT2VOptions extends GflowGenerationOptions {
  prompt: string;
  model?: string; // "omni-flash" | "veo-2"
  aspect?: string; // "9:16" | "16:9" | "1:1"
}

export interface VideoI2VOptions extends GflowGenerationOptions {
  prompt: string;
  initialFrame: string; // local path or UUID
  model?: string;
  aspect?: string;
}

export interface ImageT2IOptions extends GflowGenerationOptions {
  prompt: string;
  model?: string; // "nano-pro" | "nano2" | "image4"
  aspect?: string;
  count?: number;
}

export interface ImageI2IOptions extends GflowGenerationOptions {
  prompt: string;
  references: string[];
  model?: string;
  aspect?: string;
}

export interface GflowProxyResult {
  success: boolean;
  task_id: string;
  filename: string;
  local_path: string;
  media_url: string;
  remote_url: string;
  r2_url?: string | null;
  data_uri?: string | null;
  markdown_preview: string;
}

export class GflowProxyClient {
  private baseUrl: string;

  constructor(baseUrl = process.env.GFLOW_PROXY_URL || "http://localhost:1235") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async health() {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json();
  }

  async generateVideoT2V(options: VideoT2VOptions): Promise<GflowProxyResult> {
    const res = await fetch(`${this.baseUrl}/v1/video/t2v`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: options.prompt,
        model: options.model,
        aspect: options.aspect,
        project_id: options.projectId,
        profile: options.profile,
        wait: options.wait !== false,
        upload_r2: options.uploadR2,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data as GflowProxyResult;
  }

  async generateVideoI2V(options: VideoI2VOptions): Promise<GflowProxyResult> {
    const res = await fetch(`${this.baseUrl}/v1/video/i2v`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: options.prompt,
        initial_frame: options.initialFrame,
        model: options.model,
        aspect: options.aspect,
        project_id: options.projectId,
        profile: options.profile,
        wait: options.wait !== false,
        upload_r2: options.uploadR2,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data as GflowProxyResult;
  }

  async generateImageT2I(options: ImageT2IOptions): Promise<GflowProxyResult> {
    const res = await fetch(`${this.baseUrl}/v1/image/t2i`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: options.prompt,
        model: options.model,
        aspect: options.aspect,
        count: options.count,
        project_id: options.projectId,
        profile: options.profile,
        wait: options.wait !== false,
        upload_r2: options.uploadR2,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data as GflowProxyResult;
  }

  async generateImageI2I(options: ImageI2IOptions): Promise<GflowProxyResult> {
    const res = await fetch(`${this.baseUrl}/v1/image/i2i`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: options.prompt,
        references: options.references,
        model: options.model,
        aspect: options.aspect,
        project_id: options.projectId,
        profile: options.profile,
        wait: options.wait !== false,
        upload_r2: options.uploadR2,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data as GflowProxyResult;
  }

  async pollTask(taskId: string) {
    const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}`);
    return res.json();
  }
}
