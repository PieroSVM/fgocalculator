"""Rebuild index.html from tools/template.html and data/queue.json.

Usage: python3 tools/build.py
"""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
template = (root / "tools" / "template.html").read_text(encoding="utf-8")
data = json.loads((root / "data" / "queue.json").read_text(encoding="utf-8"))
embed = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
(root / "index.html").write_text(template.replace("__ATLAS__", embed), encoding="utf-8")
print(f"index.html built with {len(data['steps'])} steps")
