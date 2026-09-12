"""gflow-api-proxy Python Client.

Usage:
    from client import GflowProxyClient

    client = GflowProxyClient()
    res = client.generate_video_t2v("Macro cinematic shot of ocean waves", aspect="9:16")
    print(res["media_url"])
    print(res["markdown_preview"])
"""

import os
from typing import Any, Dict, List, Optional
import requests


class GflowProxyClient:
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or os.environ.get("GFLOW_PROXY_URL") or "http://localhost:1235").rstrip("/")

    def health(self) -> Dict[str, Any]:
        res = requests.get(f"{self.base_url}/health", timeout=10)
        res.raise_for_status()
        return res.json()

    def generate_video_t2v(
        self,
        prompt: str,
        model: str = "omni-flash",
        aspect: str = "9:16",
        project_id: Optional[str] = None,
        profile: Optional[str] = None,
        wait: bool = True,
        upload_r2: bool = False,
        timeout: int = 240,
    ) -> Dict[str, Any]:
        payload = {
            "prompt": prompt,
            "model": model,
            "aspect": aspect,
            "wait": wait,
            "upload_r2": upload_r2,
        }
        if project_id:
            payload["project_id"] = project_id
        if profile:
            payload["profile"] = profile

        res = requests.post(f"{self.base_url}/v1/video/t2v", json=payload, timeout=timeout if wait else 15)
        res.raise_for_status()
        return res.json()

    def generate_video_i2v(
        self,
        prompt: str,
        initial_frame: str,
        model: str = "omni-flash",
        aspect: str = "9:16",
        project_id: Optional[str] = None,
        profile: Optional[str] = None,
        wait: bool = True,
        upload_r2: bool = False,
        timeout: int = 240,
    ) -> Dict[str, Any]:
        payload = {
            "prompt": prompt,
            "initial_frame": initial_frame,
            "model": model,
            "aspect": aspect,
            "wait": wait,
            "upload_r2": upload_r2,
        }
        if project_id:
            payload["project_id"] = project_id
        if profile:
            payload["profile"] = profile

        res = requests.post(f"{self.base_url}/v1/video/i2v", json=payload, timeout=timeout if wait else 15)
        res.raise_for_status()
        return res.json()

    def generate_image_t2i(
        self,
        prompt: str,
        model: str = "nano-pro",
        aspect: str = "1:1",
        count: int = 1,
        project_id: Optional[str] = None,
        profile: Optional[str] = None,
        wait: bool = True,
        upload_r2: bool = False,
        timeout: int = 120,
    ) -> Dict[str, Any]:
        payload = {
            "prompt": prompt,
            "model": model,
            "aspect": aspect,
            "count": count,
            "wait": wait,
            "upload_r2": upload_r2,
        }
        if project_id:
            payload["project_id"] = project_id
        if profile:
            payload["profile"] = profile

        res = requests.post(f"{self.base_url}/v1/image/t2i", json=payload, timeout=timeout if wait else 15)
        res.raise_for_status()
        return res.json()

    def generate_image_i2i(
        self,
        prompt: str,
        references: List[str],
        model: str = "image4",
        aspect: str = "1:1",
        project_id: Optional[str] = None,
        profile: Optional[str] = None,
        wait: bool = True,
        upload_r2: bool = False,
        timeout: int = 120,
    ) -> Dict[str, Any]:
        payload = {
            "prompt": prompt,
            "references": references,
            "model": model,
            "aspect": aspect,
            "wait": wait,
            "upload_r2": upload_r2,
        }
        if project_id:
            payload["project_id"] = project_id
        if profile:
            payload["profile"] = profile

        res = requests.post(f"{self.base_url}/v1/image/i2i", json=payload, timeout=timeout if wait else 15)
        res.raise_for_status()
        return res.json()

    def poll_task(self, task_id: str) -> Dict[str, Any]:
        res = requests.get(f"{self.base_url}/v1/tasks/{task_id}", timeout=10)
        res.raise_for_status()
        return res.json()
