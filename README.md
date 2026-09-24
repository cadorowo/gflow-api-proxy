# 🚀 gflow-api-proxy

Multi-profile HTTP API proxy for **Google Flow** (Veo 3.1 & Imagen / Nano Banana) with Playwright queue serialization, local media hosting and Cloudflare R2 support.

---

## 🎯 Features

- **Queue Serialization Anti-Lock**: Automatically coordinates Playwright Chrome instances per Google profile to prevent `ProfileLockedError` and singleton crashes.
- **Local Media Server**: All generated videos/images are stored locally in `storage/` and served via `/media/:filename` with HTTP Range streaming support.
- **Tailscale & Remote Ready**: Auto-detects Tailscale IP to return direct remote URLs for browsing from your phone or remote laptop.
- **Instant Markdown Preview**: Returns `markdown_preview` and Base64 Data URI for immediate visual rendering inside chat UIs (like Paseo).
- **Cloudflare R2 On-Demand**: Pass `"upload_r2": true` to upload directly to R2 and get a public CDN link.
- **OpenAI Drop-In Compatible**: Standard `/v1/images/generations` and `/v1/models` endpoints.

---

## 🚀 Quick Start

### Start Server
```bash
git clone https://github.com/cadorowo/gflow-api-proxy.git
cd gflow-api-proxy
npm install
npm start
```
By default, listens on port `1235` (e.g. `http://0.0.0.0:1235`).

### Health Check
```bash
curl http://localhost:1235/health
```

---

## 📡 API Endpoints

### 1. Video Text-to-Video (Veo 3.1)
```bash
curl -X POST http://localhost:1235/v1/video/t2v \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Cinematic slow push-in shot of ocean waves at sunrise",
    "model": "omni-flash",
    "aspect": "9:16",
    "wait": true
  }'
```

### 2. Video Image-to-Video
```bash
curl -X POST http://localhost:1235/v1/video/i2v \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "The subject turns head right with a subtle smile",
    "initial_frame": "/path/to/frame.jpg",
    "aspect": "9:16"
  }'
```

### 3. Image Text-to-Image (Imagen / Nano Banana)
```bash
curl -X POST http://localhost:1235/v1/image/t2i \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Minimalist geometric 3D character with headphones, dark aesthetic",
    "model": "nano-pro",
    "aspect": "1:1"
  }'
```

### 4. OpenAI Drop-In (`/v1/images/generations`)
```bash
curl -X POST http://localhost:1235/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Futuristic cyberpunk vehicle",
    "size": "1024x1024"
  }'
```

### 5. Async Mode & Polling
Add `"wait": false` to any generation request to get immediate `202 Accepted` with `task_id`:
```bash
curl http://localhost:1235/v1/tasks/<task_id>
```
