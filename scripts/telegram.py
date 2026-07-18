# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import sys
import os
import urllib.request
import urllib.parse
from pathlib import Path
import datetime
import re

WHATS_NEW_PATH = Path("whats-new.md")


def encode_url_parens(match):
    text = match.group(1)
    url = match.group(2).replace("(", "%28").replace(")", "%29")
    return f"[{text}]({url})"


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    title = sys.argv[1] if len(sys.argv) >= 2 else f"🔔 What's New ({now.strftime('%B')} {now.day})"
    filepath = Path(sys.argv[2]) if len(sys.argv) >= 3 else WHATS_NEW_PATH

    if not filepath.exists() or not (content := filepath.read_text(encoding="utf-8").strip()):
        print(f"File {filepath} not found or empty, skipping notification.")
        return

    lines = [
        line.lstrip("# ") if line.startswith("#") else line
        for line in content.splitlines()
        if not line.startswith(("📢 *Telegram:*", "📢 _Telegram:"))
    ]

    content = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s()]+(?:\([^\s()]+\)[^\s()]*)*)\)",
        encode_url_parens,
        "\n".join(lines).strip(),
    )

    token = os.environ.get("TG_TOKEN")
    chat_id = os.environ.get("TG_CHAT")
    if not token or not chat_id:
        raise SystemExit("Error: TG_TOKEN or TG_CHAT environment variables are not set.")

    data = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": f"*{title}*\n\n{content}",
            "parse_mode": "Markdown",
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")

    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data, method="POST")
    try:
        with urllib.request.urlopen(req):
            print("Telegram notification sent successfully.")
    except Exception as e:
        raise SystemExit(f"Failed to send Telegram notification: {e}")


if __name__ == "__main__":
    main()
