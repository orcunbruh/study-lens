# -*- coding: utf-8 -*-
"""
StudyLens — Bağlamsal AI Ders & Not Çalışma Merkezi (Antigravity 3.8 Flash)
Sunucu ve Doğrudan Antigravity LanguageServer HTTPS RPC (`StartCascade` / `SendUserCascadeMessage`) Köprüsü.
"""

from __future__ import annotations

import base64
import http.server
import json
import os
import re
import socketserver
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PORT = 8095
ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "static"
PLOTS_DIR = STATIC_DIR / "plots"
RUNTIME_DIR = ROOT_DIR / "runtime"
SNIPS_DIR = RUNTIME_DIR / "snips"
PINS_DIR = RUNTIME_DIR / "pins"
PDFS_DIR = RUNTIME_DIR / "pdfs"
NOTES_DIR = ROOT_DIR / "notes"

USER_HOME = Path.home()
ORCUNOS_KNOWLEDGE_DIR = USER_HOME / "Documents" / "OrcunOS" / "knowledge"
ANTIGRAVITY_BRAIN_DIR = USER_HOME / ".gemini" / "antigravity" / "brain"

# Antigravity UI içindeki gerçek Gemini 3.8 Flash model kimlikleri (GetCascadeModelConfigData'dan doğrulandı)
FLASH_MODELS: Dict[str, Tuple[str, str]] = {
    "low": ("MODEL_PLACEHOLDER_M320", "Gemini 3.8 Flash (Low)"),
    "medium": ("MODEL_PLACEHOLDER_M319", "Gemini 3.8 Flash (Medium)"),
    "high": ("MODEL_PLACEHOLDER_M318", "Gemini 3.8 Flash (High)"),
}

for d in (STATIC_DIR, PLOTS_DIR, RUNTIME_DIR, SNIPS_DIR, PINS_DIR, PDFS_DIR, NOTES_DIR):
    d.mkdir(parents=True, exist_ok=True)


class AntigravityFlashBridge:
    """
    Yerel Antigravity `language_server.exe` HTTPS RPC sunucusuna doğrudan bağlanır.
    - `StartCascade` ve `SendUserCascadeMessage` çağrılarında doğrudan UI'daki
      `Gemini 3.8 Flash (Low/Medium/High)` (`MODEL_PLACEHOLDER_M320/M319/M318`) modelini seçer.
    - Kırpılan PNG görüntüsünü `media` (`inlineData`) olarak doğrudan mesaja gömer.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ssl_ctx = ssl._create_unverified_context()
        self._cached_pid: Optional[int] = None
        self._cached_https_port: Optional[int] = None
        self._cached_csrf: Optional[str] = None
        self._session_file = RUNTIME_DIR / "flash_cascade_session_v2.json"
        self._ls_cache_file = RUNTIME_DIR / "ls_https_cache.json"
        self._load_ls_cache()

    def _load_ls_cache(self) -> None:
        if self._ls_cache_file.exists():
            try:
                d = json.loads(self._ls_cache_file.read_text(encoding="utf-8"))
                self._cached_pid = int(d.get("pid") or 0) or None
                self._cached_https_port = int(d.get("https_port") or 0) or None
                self._cached_csrf = d.get("csrf") or None
            except Exception:
                pass

    def _save_ls_cache(self) -> None:
        try:
            self._ls_cache_file.write_text(
                json.dumps(
                    {
                        "pid": self._cached_pid,
                        "https_port": self._cached_https_port,
                        "csrf": self._cached_csrf,
                    }
                ),
                encoding="utf-8",
            )
        except Exception:
            pass

    def _rpc_post(
        self, https_port: int, csrf: str, method: str, payload: Dict[str, Any], timeout: float = 10.0
    ) -> Dict[str, Any]:
        url = f"https://127.0.0.1:{https_port}/exa.language_server_pb.LanguageServerService/{method}"
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=raw,
            headers={
                "Content-Type": "application/json",
                "x-codeium-csrf-token": csrf,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, context=self._ssl_ctx, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace").strip()
            return json.loads(body) if body else {}

    def _discover_language_server(self, force: bool = False) -> Tuple[int, int, str]:
        if (
            not force
            and self._cached_pid
            and self._cached_https_port
            and self._cached_csrf
        ):
            return self._cached_pid, self._cached_https_port, self._cached_csrf

        is_windows = sys.platform.startswith("win")
        candidates: List[Tuple[int, str, List[int]]] = []

        if is_windows:
            ps_script = (
                "$procs = Get-CimInstance Win32_Process -Filter \"Name = 'language_server.exe'\"; "
                "$result = @(); "
                "foreach ($p in $procs) { "
                "  $conns = Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | "
                "    Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort; "
                "  $result += [PSCustomObject]@{ pid = $p.ProcessId; cmd = $p.CommandLine; ports = @($conns) } "
                "}; "
                "$result | ConvertTo-Json -Compress"
            )
            try:
                proc = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=8,
                )
                raw = (proc.stdout or "").strip()
                if raw:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        data = [data]
                    for entry in data:
                        pid = int(entry.get("pid") or 0)
                        cmd = entry.get("cmd") or ""
                        ports = [int(p) for p in (entry.get("ports") or []) if p]
                        candidates.append((pid, cmd, ports))
            except Exception:
                pass
        else:
            # macOS / Linux desteği
            try:
                # language_server veya language_server.exe süreçlerini bul
                ps_out = subprocess.run(
                    ["ps", "-eo", "pid,command"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                ).stdout or ""
                ls_pids: List[Tuple[int, str]] = []
                for line in ps_out.splitlines():
                    if "language_server" in line and not "grep" in line:
                        parts = line.strip().split(None, 1)
                        if len(parts) == 2 and parts[0].isdigit():
                            ls_pids.append((int(parts[0]), parts[1]))

                for pid, cmd in ls_pids:
                    # lsof ile bu pid'nin dinlediği TCP portlarını al
                    lsof_out = subprocess.run(
                        ["lsof", "-aPiTCP", "-sTCP:LISTEN", "-p", str(pid), "-Fn"],
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=5,
                    ).stdout or ""
                    ports: List[int] = []
                    for pline in lsof_out.splitlines():
                        if pline.startswith("n") and ":" in pline:
                            try:
                                port_str = pline.split(":")[-1]
                                ports.append(int(port_str))
                            except ValueError:
                                pass
                    if ports:
                        candidates.append((pid, cmd, ports))
            except Exception:
                pass

        if not candidates:
            raise RuntimeError(
                "Çalışan Antigravity language_server süreci bulunamadı. Lütfen Antigravity uygulamasının açık olduğundan emin olun."
            )

        for pid, cmd, ports in candidates:
            m = re.search(r"--csrf_token[=\s]+([0-9a-fA-F-]+)", cmd)
            if not m or not ports:
                continue
            csrf = m.group(1)
            for port in sorted(ports):
                try:
                    res = self._rpc_post(
                        int(port), csrf, "GetCascadeModelConfigData", {}, timeout=2.5
                    )
                    if "clientModelConfigs" in res:
                        self._cached_pid = pid
                        self._cached_https_port = int(port)
                        self._cached_csrf = csrf
                        self._save_ls_cache()
                        return pid, int(port), csrf
                except Exception:
                    continue

        raise RuntimeError(
            "Antigravity language_server süreci bulundu ancak HTTPS RPC portu doğrulanamadı."
        )

    def _call_rpc(self, method: str, payload: Dict[str, Any], timeout: float = 15.0) -> Dict[str, Any]:
        for attempt in range(2):
            _, https_port, csrf = self._discover_language_server(force=(attempt > 0))
            try:
                return self._rpc_post(https_port, csrf, method, payload, timeout=timeout)
            except urllib.error.HTTPError as he:
                err_body = he.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"RPC {method} HTTP {he.code}: {err_body}")
            except Exception as e:
                if attempt == 0:
                    continue
                raise RuntimeError(f"RPC {method} bağlantı hatası: {e}")
        raise RuntimeError("Beklenmeyen RPC hatası.")

    def _get_or_create_cascade(self, model_enum: str, force_new: bool = False) -> str:
        if not force_new and self._session_file.exists():
            try:
                saved = json.loads(self._session_file.read_text(encoding="utf-8"))
                cid = saved.get("cascade_id", "")
                if cid and (ANTIGRAVITY_BRAIN_DIR / cid).exists():
                    return cid
            except Exception:
                pass

        resp = self._call_rpc(
            "StartCascade",
            {
                "source": 1,
                "trajectoryType": 1,
                "requestedModel": model_enum,
            },
        )
        cid = resp.get("cascadeId", "")
        if not cid:
            raise RuntimeError(f"StartCascade cascadeId döndürmedi: {resp}")

        self._session_file.write_text(
            json.dumps(
                {
                    "cascade_id": cid,
                    "model_enum": model_enum,
                    "created_at": time.time(),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return cid

    def _count_transcript_lines(self, conv_id: str) -> int:
        t_full = (
            ANTIGRAVITY_BRAIN_DIR
            / conv_id
            / ".system_generated"
            / "logs"
            / "transcript_full.jsonl"
        )
        t_compact = (
            ANTIGRAVITY_BRAIN_DIR
            / conv_id
            / ".system_generated"
            / "logs"
            / "transcript.jsonl"
        )
        target = t_full if t_full.exists() else t_compact
        if not target.exists():
            return 0
        try:
            with target.open("r", encoding="utf-8", errors="replace") as f:
                return sum(1 for _ in f)
        except Exception:
            return 0

    def _wait_for_answer(
        self, conv_id: str, start_line: int, timeout_sec: float = 45.0
    ) -> Tuple[str, Optional[str]]:
        t_full = (
            ANTIGRAVITY_BRAIN_DIR
            / conv_id
            / ".system_generated"
            / "logs"
            / "transcript_full.jsonl"
        )
        t_compact = (
            ANTIGRAVITY_BRAIN_DIR
            / conv_id
            / ".system_generated"
            / "logs"
            / "transcript.jsonl"
        )
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            target = t_full if t_full.exists() else t_compact
            if target.exists():
                try:
                    lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
                    for line in lines[start_line:]:
                        line = line.strip()
                        if not line:
                            continue
                        obj = json.loads(line)
                        if (
                            obj.get("source") == "MODEL"
                            and obj.get("type") == "PLANNER_RESPONSE"
                            and obj.get("status") == "DONE"
                        ):
                            tool_calls = obj.get("tool_calls") or []
                            content = (obj.get("content") or "").strip()
                            thinking = (obj.get("thinking") or "").strip()
                            if not tool_calls and content:
                                return content, thinking
                except Exception:
                    pass
            time.sleep(0.10)
        raise TimeoutError(
            "Gemini 3.8 Flash yanıt süresi aşıldı (45 sn). Lütfen tekrar deneyin."
        )

    def _verify_response_model(self, cid: str) -> str:
        try:
            meta = self._call_rpc(
                "GetCascadeTrajectoryGeneratorMetadata", {"cascadeId": cid}, timeout=3.0
            )
            gens = meta.get("generatorMetadata") or []
            if gens:
                cm = gens[-1].get("chatModel") or {}
                return f"{cm.get('model', '')} ({cm.get('responseModel', '')})"
        except Exception:
            pass
        return "Gemini 3.8 Flash"

    def ask_flash(
        self,
        *,
        note_title: str,
        section_title: str,
        doc_summary: str,
        card_context: str,
        selected_latex: List[str],
        selected_text: str,
        equation_focus_hint: str,
        question: str,
        raw_image_b64: Optional[str],
        snip_filename: Optional[str],
        history: List[Dict[str, str]],
        flash_level: str = "medium",
    ) -> Dict[str, Any]:
        t0 = time.time()
        level_key = flash_level.lower() if flash_level.lower() in FLASH_MODELS else "medium"
        model_enum, model_label = FLASH_MODELS[level_key]

        with self._lock:
            latex_block = (
                "\n".join(f"  - `{l}`" for l in selected_latex if l.strip())
                if selected_latex
                else "  - (Görsel / Metin seçimi — ekteki kırpılan görsele bak)"
            )

            history_block = ""
            if history:
                turns = []
                for h in history[-6:]:
                    role = "Öğrenci" if h.get("role") == "user" else "3.8 Flash Öğretmen"
                    turns.append(f"**{role}:** {h.get('content', '').strip()}")
                history_block = (
                    "\n### 🔄 Bu Baloncuktaki Önceki Konuşma Geçmişi:\n"
                    + "\n\n".join(turns)
                    + "\n"
                )

            prompt = f"""[STUDYLENS • {model_label.upper()} DERS AÇIKLAMA İSTEĞİ]
Sen Orçun'un StudyLens uygulaması içindeki özel matematik ve bilgisayar bilimleri öğretmenisin ({model_label}).
KESİN KURAL: Hiçbir araç (`run_command`, `read_file`, `write_file`, `edit_file` vb.) ÇAĞIRMA! Kırpılan bölgenin görseli zaten doğrudan bu mesaja görüntü olarak eklendi ve LaTeX/metin bağlamı aşağıda verildi. Doğrudan, samimi, net Türkçe ve `$...$` / `$$...$$` LaTeX formatıyla yanıt ver.

### 📚 1. Genel Ders & Konu Bağlamı
- **Ders Notu:** {note_title}
- **Aktif Bölüm / Başlık:** {section_title}
- **Konu Özeti:** {doc_summary}

### 📄 2. Seçimin İçinde Bulunduğu Kart / Örnek / Sayfa Bağlamı (Tam Metin)
```text
{card_context[:3000]}
```

### ✂️ 3. Orçun'un Shift + Ekran Kırpıcı ile Seçtiği Özel Kısım (Anlamadığı Yer)
- **Seçim Konumu / Odak İpucu:** {equation_focus_hint or "Kutu içine alınan bölge"}
- **Kutu İçindeki Ham LaTeX İfadeleri:**
{latex_block}
- **Kutu İçindeki Metin:**
`{selected_text[:800] if selected_text else "(Ekteki kırpılan görsele bakınız)"}`
{history_block}
### ❓ 4. Orçun'un Sorusu
**"{question}"**

Lütfen doğrudan Orçun'un seçtiği bu adıma odaklan:
1. Eğer bir `=` geçişi veya formül adımı seçildiyse, eşitliğin solundan/önceki adımdan bu seçilen kısma **hangi cebirsel/mantıksal işlemle** geçildiğini ara basamakları atlamadan göster.
2. Bu adımın sezgisel mantığını ("Neden böyle yaptık?") 1-2 cümleyle netleştir.
3. Gereksiz giriş cümleleri kurmadan ilk cümlede açıklamaya başla."""

            cid = self._get_or_create_cascade(model_enum, force_new=False)
            start_line = self._count_transcript_lines(cid)

            media_list = []
            if raw_image_b64:
                media_list.append(
                    {
                        "mimeType": "image/png",
                        "inlineData": raw_image_b64,
                        "displayName": snip_filename or "snip.png",
                    }
                )

            msg_payload: Dict[str, Any] = {
                "cascadeId": cid,
                "items": [{"text": prompt}],
                "cascadeConfig": {
                    "plannerConfig": {
                        "planModel": model_enum,
                        "requestedModel": {"model": model_enum},
                    }
                },
            }
            if media_list:
                msg_payload["media"] = media_list

            try:
                self._call_rpc("SendUserCascadeMessage", msg_payload)
            except Exception:
                # Oturum geçersizleşmişse yeni aç ve tekrar gönder
                cid = self._get_or_create_cascade(model_enum, force_new=True)
                start_line = 0
                msg_payload["cascadeId"] = cid
                self._call_rpc("SendUserCascadeMessage", msg_payload)

            answer, thinking = self._wait_for_answer(cid, start_line=start_line)
            verified_model = self._verify_response_model(cid)
            elapsed_ms = int((time.time() - t0) * 1000)
            return {
                "ok": True,
                "conversation_id": cid,
                "model": model_label,
                "verified_backend_model": verified_model,
                "answer": answer,
                "thinking": thinking,
                "elapsed_ms": elapsed_ms,
                "snip_url": f"/runtime/snips/{snip_filename}" if snip_filename else None,
            }

    def status(self) -> Dict[str, Any]:
        try:
            pid, https_port, _ = self._discover_language_server(force=False)
            return {
                "connected": True,
                "model": "Gemini 3.8 Flash (M318/M319/M320)",
                "pid": pid,
                "address": f"https://127.0.0.1:{https_port}",
            }
        except Exception as e:
            return {
                "connected": False,
                "model": "Gemini 3.8 Flash",
                "error": str(e),
            }


FLASH_BRIDGE = AntigravityFlashBridge()


def _extract_markdown_meta(md_path: Path) -> Dict[str, Any]:
    text = md_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    title = md_path.stem.replace("_", " ")
    subtitle = ""
    chapters: List[Dict[str, str]] = []

    for line in lines[:35]:
        if line.startswith("# ") and title == md_path.stem.replace("_", " "):
            title = line[2:].strip()
        elif line.startswith("## ") and not subtitle and "İÇİNDEKİLER" not in line.upper():
            subtitle = line[3:].strip()

    for line in lines:
        m1 = re.match(r"^(#{1,2})\s+(.+)$", line)
        if m1:
            lvl = len(m1.group(1))
            heading = m1.group(2).strip()
            slug = re.sub(r"[^a-z0-9ğüşıöçĞÜŞİÖÇ]+", "-", heading.lower()).strip("-")
            chapters.append({"level": lvl, "title": heading, "slug": slug})

    summary_lines = []
    for line in lines[:60]:
        clean = line.strip().lstrip(">").strip()
        if clean and not clean.startswith("#") and not clean.startswith("---"):
            summary_lines.append(clean)
        if len(" ".join(summary_lines)) > 420:
            break

    return {
        "title": title,
        "subtitle": subtitle,
        "summary": " ".join(summary_lines)[:500],
        "chapters": chapters[:40],
        "line_count": len(lines),
    }


def _rewrite_markdown_assets(md_text: str) -> str:
    def repl(match: re.Match) -> str:
        alt = match.group(1)
        raw_path = match.group(2).strip()
        filename = Path(raw_path.replace("\\", "/")).name
        stem = Path(filename).stem
        svg_candidate = PLOTS_DIR / f"{stem}.svg"
        png_candidate = PLOTS_DIR / f"{stem}.png"
        if svg_candidate.exists():
            return f"![{alt}](/static/plots/{stem}.svg)"
        if png_candidate.exists():
            return f"![{alt}](/static/plots/{stem}.png)"
        return match.group(0)

    return re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", repl, md_text)


def _load_pins(note_id: str) -> List[Dict[str, Any]]:
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", note_id)
    pfile = PINS_DIR / f"{safe_id}.json"
    if not pfile.exists():
        return []
    try:
        return json.loads(pfile.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_pins(note_id: str, pins: List[Dict[str, Any]]) -> None:
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", note_id)
    pfile = PINS_DIR / f"{safe_id}.json"
    pfile.write_text(json.dumps(pins, ensure_ascii=False, indent=2), encoding="utf-8")


def get_library_items() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen_names = set()

    search_dirs = [ORCUNOS_KNOWLEDGE_DIR, NOTES_DIR]
    for sdir in search_dirs:
        if not sdir.exists():
            continue
        for md_file in sorted(sdir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
            if md_file.name.lower() in (
                "index.md",
                "log.md",
                "beyin-kurulum-test-bilgisi.md",
                "windows-11-show-desktop-widget.md",
            ):
                continue
            if md_file.name in seen_names:
                continue
            seen_names.add(md_file.name)
            note_id = md_file.stem
            meta = _extract_markdown_meta(md_file)
            pins = _load_pins(note_id)
            has_lab = "mat3327" in note_id.lower()
            items.append(
                {
                    "id": note_id,
                    "type": "markdown",
                    "filename": md_file.name,
                    "source_dir": str(sdir),
                    "title": meta["title"],
                    "subtitle": meta["subtitle"],
                    "summary": meta["summary"],
                    "chapter_count": len(meta["chapters"]),
                    "line_count": meta["line_count"],
                    "pin_count": len(pins),
                    "has_interactive_lab": has_lab,
                    "lab_url": "/static/labs/mat3327/index.html" if has_lab else None,
                    "updated_at": time.strftime(
                        "%d.%m.%Y %H:%M", time.localtime(md_file.stat().st_mtime)
                    ),
                }
            )

    if PDFS_DIR.exists():
        for pdf_file in sorted(PDFS_DIR.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True):
            note_id = f"pdf_{pdf_file.stem}"
            pins = _load_pins(note_id)
            items.append(
                {
                    "id": note_id,
                    "type": "pdf",
                    "filename": pdf_file.name,
                    "pdf_url": f"/runtime/pdfs/{urllib.parse.quote(pdf_file.name)}",
                    "title": pdf_file.stem.replace("_", " ") + " (PDF)",
                    "subtitle": "PDF Ders Dokümanı / Slayt / Sınav Kağıdı",
                    "summary": f"{pdf_file.name} PDF belgesi. Shift tuşuna basılı tutarak herhangi bir formülü, grafik parçasını veya soruyu kırpıp sorabilirsiniz.",
                    "chapter_count": 0,
                    "line_count": 0,
                    "pin_count": len(pins),
                    "has_interactive_lab": False,
                    "lab_url": None,
                    "updated_at": time.strftime(
                        "%d.%m.%Y %H:%M", time.localtime(pdf_file.stat().st_mtime)
                    ),
                }
            )

    return items


def find_note_path(note_id: str) -> Optional[Path]:
    for sdir in (ORCUNOS_KNOWLEDGE_DIR, NOTES_DIR):
        candidate = sdir / f"{note_id}.md"
        if candidate.exists():
            return candidate
    return None


class StudyLensRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        body = self.rfile.read(length)
        return json.loads(body.decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            self._send_json(FLASH_BRIDGE.status())
            return

        if path == "/api/library":
            self._send_json({"ok": True, "items": get_library_items()})
            return

        if path.startswith("/api/note/"):
            note_id = urllib.parse.unquote(path[len("/api/note/") :])
            if note_id.startswith("pdf_"):
                pdf_stem = note_id[4:]
                pdf_file = PDFS_DIR / f"{pdf_stem}.pdf"
                if not pdf_file.exists():
                    self._send_json({"ok": False, "error": "PDF bulunamadı."}, 404)
                    return
                self._send_json(
                    {
                        "ok": True,
                        "id": note_id,
                        "type": "pdf",
                        "title": pdf_stem.replace("_", " "),
                        "summary": f"{pdf_file.name} PDF ders materyali.",
                        "pdf_url": f"/runtime/pdfs/{urllib.parse.quote(pdf_file.name)}",
                        "pins": _load_pins(note_id),
                    }
                )
                return

            md_path = find_note_path(note_id)
            if not md_path:
                self._send_json({"ok": False, "error": f"Not bulunamadı: {note_id}"}, 404)
                return

            meta = _extract_markdown_meta(md_path)
            raw_md = md_path.read_text(encoding="utf-8", errors="replace")
            rewritten_md = _rewrite_markdown_assets(raw_md)
            has_lab = "mat3327" in note_id.lower()
            self._send_json(
                {
                    "ok": True,
                    "id": note_id,
                    "type": "markdown",
                    "title": meta["title"],
                    "subtitle": meta["subtitle"],
                    "summary": meta["summary"],
                    "chapters": meta["chapters"],
                    "markdown": rewritten_md,
                    "pins": _load_pins(note_id),
                    "has_interactive_lab": has_lab,
                    "lab_url": "/static/labs/mat3327/index.html" if has_lab else None,
                    "source_path": str(md_path),
                }
            )
            return

        if path == "/" or path == "/index.html":
            self.path = "/static/index.html"

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            data = self._read_json_body()
        except Exception as e:
            self._send_json({"ok": False, "error": f"Geçersiz JSON: {e}"}, 400)
            return

        if path == "/api/ask":
            try:
                crop_b64 = data.get("crop_image_base64") or ""
                raw_b64: Optional[str] = None
                snip_name: Optional[str] = None
                if crop_b64.startswith("data:image/"):
                    _, raw_b64 = crop_b64.split(",", 1)
                    img_bytes = base64.b64decode(raw_b64)
                    snip_name = f"snip_{int(time.time() * 1000)}.png"
                    (SNIPS_DIR / snip_name).write_bytes(img_bytes)

                res = FLASH_BRIDGE.ask_flash(
                    note_title=data.get("note_title") or "Ders Notu",
                    section_title=data.get("section_title") or "Genel Bölüm",
                    doc_summary=data.get("doc_summary") or "",
                    card_context=data.get("card_context") or "",
                    selected_latex=data.get("selected_latex") or [],
                    selected_text=data.get("selected_text") or "",
                    equation_focus_hint=data.get("equation_focus_hint") or "",
                    question=data.get("question")
                    or "Bu seçtiğim kısmı ve nereden geldiğini adım adım açıklar mısın?",
                    raw_image_b64=raw_b64,
                    snip_filename=snip_name,
                    history=data.get("history") or [],
                    flash_level=data.get("flash_level") or "medium",
                )
                self._send_json(res)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/pins/save":
            note_id = data.get("note_id") or ""
            pin = data.get("pin") or {}
            if not note_id or not pin:
                self._send_json({"ok": False, "error": "note_id ve pin gerekli."}, 400)
                return
            pins = _load_pins(note_id)
            pin_id = pin.get("id") or f"pin_{int(time.time() * 1000)}"
            pin["id"] = pin_id
            pin["updated_at"] = time.strftime("%d.%m.%Y %H:%M")
            replaced = False
            for idx, existing in enumerate(pins):
                if existing.get("id") == pin_id:
                    pins[idx] = pin
                    replaced = True
                    break
            if not replaced:
                pins.append(pin)
            _save_pins(note_id, pins)
            self._send_json({"ok": True, "pin": pin, "pins": pins})
            return

        if path == "/api/pins/delete":
            note_id = data.get("note_id") or ""
            pin_id = data.get("pin_id") or ""
            pins = [p for p in _load_pins(note_id) if p.get("id") != pin_id]
            _save_pins(note_id, pins)
            self._send_json({"ok": True, "pins": pins})
            return

        if path == "/api/upload":
            filename = os.path.basename(data.get("filename") or "")
            content_b64 = data.get("content_base64") or ""
            if not filename or not content_b64:
                self._send_json({"ok": False, "error": "Dosya adı ve içerik gerekli."}, 400)
                return
            if "," in content_b64:
                _, content_b64 = content_b64.split(",", 1)
            raw_bytes = base64.b64decode(content_b64)
            ext = Path(filename).suffix.lower()
            if ext == ".pdf":
                dest = PDFS_DIR / filename
                dest.write_bytes(raw_bytes)
                note_id = f"pdf_{dest.stem}"
            elif ext in (".md", ".markdown", ".txt"):
                dest = NOTES_DIR / filename
                dest.write_bytes(raw_bytes)
                note_id = dest.stem
            else:
                self._send_json(
                    {"ok": False, "error": "Yalnızca .md ve .pdf dosyaları desteklenir."},
                    400,
                )
                return
            self._send_json({"ok": True, "note_id": note_id, "items": get_library_items()})
            return

        if path == "/api/note/delete":
            note_id = (data.get("note_id") or "").strip()
            if not note_id:
                self._send_json({"ok": False, "error": "note_id gerekli."}, 400)
                return

            deleted_any = False
            if note_id.startswith("pdf_"):
                pdf_stem = note_id[4:]
                pdf_file = PDFS_DIR / f"{pdf_stem}.pdf"
                if pdf_file.exists():
                    pdf_file.unlink()
                    deleted_any = True
            else:
                for sdir in (NOTES_DIR, ORCUNOS_KNOWLEDGE_DIR):
                    candidate = sdir / f"{note_id}.md"
                    if candidate.exists():
                        candidate.unlink()
                        deleted_any = True

            safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", note_id)
            pfile = PINS_DIR / f"{safe_id}.json"
            if pfile.exists():
                try:
                    pfile.unlink()
                except Exception:
                    pass

            if not deleted_any:
                self._send_json({"ok": False, "error": "Silinecek dosya bulunamadı."}, 404)
                return

            self._send_json({"ok": True, "deleted_id": note_id, "items": get_library_items()})
            return

        self._send_json({"ok": False, "error": "Bilinmeyen API uç noktası."}, 404)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(ROOT_DIR)
    # Başlangıçta language_server HTTPS portunu ısıt
    try:
        FLASH_BRIDGE.status()
    except Exception:
        pass
    server = ThreadedHTTPServer(("0.0.0.0", PORT), StudyLensRequestHandler)
    print(f"StudyLens (Gemini 3.8 Flash Direct RPC) çalışıyor: http://localhost:{PORT}")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStudyLens kapatıldı.")
