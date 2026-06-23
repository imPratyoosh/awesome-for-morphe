# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import sys
import os
import urllib.request
import urllib.parse
from pathlib import Path


def main():
    if len(sys.argv) < 3:
        print("Usage: python src/telegram_notify.py <title> <filepath>")
        sys.exit(1)

    title = sys.argv[1]
    filepath = Path(sys.argv[2])

    if not filepath.exists():
        print(f"File {filepath} not found, skipping notification.")
        return

    content = filepath.read_text(encoding="utf-8").strip()
    if not content:
        print(f"File {filepath} is empty, skipping notification.")
        return

    content = "\n".join(
        line.lstrip("# ") if line.startswith("#") else line
        for line in content.splitlines()
        if not line.startswith("📢 *Telegram:*")
    ).strip()

    message = f"*{title}*\n\n{content}"

    token = os.environ.get("TG_TOKEN")
    chat_id = os.environ.get("TG_CHAT")
    if not token or not chat_id:
        print("Error: TG_TOKEN or TG_CHAT environment variables are not set.")
        sys.exit(1)

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "Markdown",
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req):
            print("Telegram notification sent successfully.")
    except Exception as e:
        print(f"Failed to send Telegram notification: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
