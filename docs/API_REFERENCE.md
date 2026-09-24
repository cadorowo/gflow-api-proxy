# 📚 Google Flow API Proxy — Reference Documentation

`gflow-api-proxy` is a high-performance HTTP service that exposes Google Flow (Veo 3.1 & Imagen / Nano Banana) capabilities as a standardized REST API.

---

## 🏗️ Architecture & Network

- **Daemon**: Managed via user systemd service (`gflow-proxy.service`).
- **Default Port**: `1235` (binds to `0.0.0.0`).
- **Local Access**: `http://localhost:1235`
- **Tailscale Remote Access**: `http://<tailscale-ip>:1235`
- **Concurrency Manager**: In-memory FIFO queue per Google profile preventing Playwright/Chrome `SingletonLock` errors.
- **Fail-Fast Policy**: If an auth session expires (HTTP 401), all pending tasks for that profile are aborted immediately with 401 rather than stalling the queue.
- **Media Storage**: Local storage in `./storage/` with HTTP Range streaming support.
- **R2 Cloud Hosting**: Optional on-demand upload to Cloudflare R2 bucket.

---

## 🛠️ Service Management

```bash
# Check status
systemctl --user status gflow-proxy.service

# View real-time logs
journalctl --user -u gflow-proxy.service -f

# Restart service
systemctl --user restart gflow-proxy.service

# Stop service
systemctl --user stop gflow-proxy.service
```

---

## 📡 API Endpoints

### 1. Health & Status
`GET /health` or `GET /`

Returns system health, active/queued jobs per Google profile, Tailscale IPs, and local paths.

**Response (200 OK):**
```json
{
  "status": "ok",
  "service": "gflow-api-proxy",
  "version": "1.0.0",
  "gflow_bin": "/usr/local/bin/gflow",
  "default_profile": "default",
  "profiles": [
    {
      "profile": "default",
      "running": false,
      "queued": 0,
      "state": "healthy",
      "lastError": null
    }
  ],
  "network": {
    "port": 1235,
    "local_host": "http://localhost:1235",
    "remote_host": "http://<remote-ip>:1235",
    "tailscale_ip": "<remote-ip>"
  },
  "storage_dir": "/path/to/gflow-api-proxy/storage"
}
```

---

### 2. Available Models
`GET /v1/models`

Lists all supported generation models.

**Response (200 OK):**
```json
{
  "object": "list",
  "data": [
    { "id": "omni-flash", "object": "model", "type": "video", "default": true },
    { "id": "veo-2", "object": "model", "type": "video" },
    { "id": "nano-pro", "object": "model", "type": "image", "default": true },
    { "id": "nano2", "object": "model", "type": "image" },
    { "id": "image4", "object": "model", "type": "image" }
  ]
}
```

---

### 3. Video Text-to-Video
`POST /v1/video/t2v`

Generates high-definition video using Veo 3.1.

**Request Body:**
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | **Yes** | - | Creative visual prompt |
| `model` | string | No | `"omni-flash"` | `"omni-flash"` or `"veo-2"` |
| `aspect` | string | No | `"9:16"` | `"9:16"`, `"16:9"`, `"1:1"` |
| `project_id` | string | No | configured default | Target Google Flow project UUID |
| `profile` | string | No | `"default"` | Account profile to use |
| `wait` | boolean | No | `true` | `true` = wait for file; `false` = return `202 Accepted` + `task_id` |
| `upload_r2` | boolean | No | `false` | Upload result to Cloudflare R2 |

**Example Request:**
```bash
curl -X POST http://localhost:1235/v1/video/t2v \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Cinematic slow motion macro shot of desert sand dunes under golden hour sunlight",
    "model": "omni-flash",
    "aspect": "9:16",
    "wait": true,
    "upload_r2": true
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "task_id": "task_1789223400_a1b2c3d4",
  "filename": "gflow_video_1789223400.mp4",
  "local_path": "/path/to/gflow-api-proxy/storage/gflow_video_1789223400.mp4",
  "media_url": "http://localhost:1235/media/gflow_video_1789223400.mp4",
  "remote_url": "http://<remote-ip>:1235/media/gflow_video_1789223400.mp4",
  "r2_url": "https://pub-xxxxxx.r2.dev/gflow_video_1789223400.mp4",
  "data_uri": null,
  "markdown_preview": "<video src=\"http://<remote-ip>:1235/media/gflow_video_1789223400.mp4\" controls width=\"100%\"></video>"
}
```

---

### 4. Video Image-to-Video
`POST /v1/video/i2v`

Animates a starting frame or asset.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | **Yes** | Motion instructions |
| `initial_frame` | string | **Yes** | Absolute local image path or Flow media UUID |
| `model` | string | No | Default: `"omni-flash"` |
| `aspect` | string | No | Default: `"9:16"` |
| `wait` | boolean | No | Default: `true` |
| `upload_r2` | boolean | No | Default: `false` |

---

### 5. Image Text-to-Image
`POST /v1/image/t2i`

Generates 1 to 4 images using Nano Banana Pro / Imagen models.

**Request Body:**
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | **Yes** | - | Creative prompt |
| `model` | string | No | `"nano-pro"` | `"nano-pro"`, `"nano2"`, `"image4"` |
| `aspect` | string | No | `"1:1"` | `"1:1"`, `"9:16"`, `"16:9"`, `"4:3"`, `"3:4"` |
| `count` | number | No | `1` | Number of images (1-4) |
| `wait` | boolean | No | `true` | Return result or task ID |
| `upload_r2` | boolean | No | `false` | Upload to Cloudflare R2 |

**Response (200 OK):**
```json
{
  "success": true,
  "task_id": "task_1789223151410_bd7c4787",
  "filename": "gflow_image_1789223151412.jpg",
  "local_path": "/path/to/gflow-api-proxy/storage/gflow_image_1789223151412.jpg",
  "media_url": "http://localhost:1235/media/gflow_image_1789223151412.jpg",
  "remote_url": "http://<remote-ip>:1235/media/gflow_image_1789223151412.jpg",
  "r2_url": null,
  "data_uri": "data:image/jpeg;base64,...",
  "markdown_preview": "![gflow_image_1789223151412.jpg](http://<remote-ip>:1235/media/gflow_image_1789223151412.jpg)"
}
```

---

### 6. Image-to-Image / Style Reference
`POST /v1/image/i2i`

Applies visual styling or continuation based on reference image(s).

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | **Yes** | Transformation prompt |
| `references` | array | **Yes** | Array of file paths or Flow media UUIDs |
| `model` | string | No | Default: `"image4"` |
| `aspect` | string | No | Default: `"1:1"` |

---

### 7. OpenAI Drop-In Generations
`POST /v1/images/generations`

Compatible with standard OpenAI client libraries (`openai.images.generate(...)`).

**Request Body:**
```json
{
  "prompt": "Futuristic neon sports car in rainy Tokyo",
  "size": "1024x1024",
  "n": 1
}
```

**Response (200 OK):**
```json
{
  "created": 1741792800,
  "data": [
    {
      "url": "http://<remote-ip>:1235/media/gflow_image_12345.jpg",
      "b64_json": "<base64 string>"
    }
  ]
}
```

---

### 8. Asynchronous Tasks & Polling
`GET /v1/tasks/:taskId`
`GET /v1/tasks`

When any endpoint is called with `"wait": false`, the proxy returns `202 Accepted`:
```json
{
  "task_id": "task_1789223151410_bd7c4787",
  "status": "pending",
  "profile": "default",
  "poll_url": "http://<remote-ip>:1235/v1/tasks/task_1789223151410_bd7c4787"
}
```

Polling the `poll_url` returns current lifecycle: `pending` ➔ `running` ➔ `completed` / `failed`.

---

### 9. Static Media Streaming
`GET /media/:filename`
`HEAD /media/:filename`

Serves files from `storage/`.
- Supports HTTP Range headers (`Range: bytes=start-end`) enabling seeking on mobile and video scrubbers.
- Serves correct MIME types (`video/mp4`, `image/jpeg`, `image/png`, `image/webp`).

---

### 10. Maintenance & Health Probing
- `POST /v1/maintenance/clean-locks`: Purges orphaned `Singleton*` lock files without touching active tasks.
- `POST /v1/auth/verify`: Runs `gflow auth status` against Google Flow and clears error states if verified.

---

## 💻 Client Integration Examples

### Python (`client.py`)
```python
from client import GflowProxyClient

client = GflowProxyClient("http://localhost:1235")

# Generate video
video = client.generate_video_t2v(
    prompt="Cinematic drone shot over snowcapped mountains",
    aspect="9:16",
    wait=True,
    upload_r2=False
)
print("Preview:", video["markdown_preview"])
print("Remote URL:", video["remote_url"])

# Generate image
image = client.generate_image_t2i(
    prompt="Minimalist character portrait, neon lighting",
    model="nano-pro",
    aspect="1:1"
)
print("Data URI:", image["data_uri"][:50] + "...")
```

### TypeScript / Bun (`client.ts`)
```typescript
import { GflowProxyClient } from "./client.ts";

const client = new GflowProxyClient("http://localhost:1235");

const result = await client.generateVideoT2V({
  prompt: "Ocean salt and fresh mint macro shot",
  aspect: "9:16",
  wait: true
});

console.log(result.remote_url);
```
