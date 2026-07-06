# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import sys
import os
import urllib.request
import urllib.parse
from pathlib import Path
import datetime
import re

CHANGELOG_PATH = Path("changelog.md")


def encode_url_parens(match):
    text = match.group(1)
    url = match.group(2).replace("(", "%28").replace(")", "%29")
    return f"[{text}]({url})"


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    title = f"🔔 What's New ({now.strftime('%B')} {now.day})"
    filepath = CHANGELOG_PATH

    if len(sys.argv) == 2:
        title = sys.argv[1]
    elif len(sys.argv) >= 3:
        title = sys.argv[1]
        filepath = Path(sys.argv[2])

    if not filepath.exists():
        print(f"File {filepath} not found, skipping notification.")
        return

    content = filepath.read_text(encoding="utf-8").strip()
    if not content:
        print(f"File {filepath} is empty, skipping notification.")
        return

    lines = []
    for line in content.splitlines():
        if line.startswith("📢 *Telegram:*") or line.startswith("📢 _Telegram:"):
            continue
        line = line.lstrip("# ") if line.startswith("#") else line
        lines.append(line)

    content = "\n".join(lines).strip()

    content = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s()]+(?:\([^\s()]+\)[^\s()]*)*)\)",
        encode_url_parens,
        content,
    )

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
