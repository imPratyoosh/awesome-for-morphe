import json
import time
import urllib.request
import urllib.error
from pathlib import Path


def fetch(url, headers=None, timeout=15, as_json=False):
    if headers is None:
        headers = {}
    headers.setdefault("User-Agent", "AwesomeForMorphe/1.0")

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                content = resp.read().decode("utf-8")
            return json.loads(content) if as_json else content

        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt < 2:
                wait = 2**attempt
                print(f"    Rate limited (HTTP {e.code}), waiting {wait}s...")
                time.sleep(wait)
            else:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 2:
                print(f"    Network error, retry {attempt + 1}/3")
                time.sleep(1)
            else:
                raise

    raise RuntimeError(f"Failed to fetch {url}")


def load_json(path):
    path = Path(path)
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        print(f"Warning: Corrupted JSON file: {path}")
        return {}
    except IOError:
        return {}


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
