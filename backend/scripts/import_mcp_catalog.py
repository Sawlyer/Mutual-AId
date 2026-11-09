"""Refresh the local MCP directory snapshot from public listing pages.

Only fiches whose detail page publishes a remote URL in the hosted-server block are stored.
The catalog keeps that URL, whether a user token is required, and the public fiche metadata.
It does not store tokens or install commands. Search stays on this SQLite file.
"""

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.connectors.mcp_catalog import DEFAULT_CATALOG_PATH, DIRECTORY_BASE_URL, refresh_catalog, write_catalog


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_CATALOG_PATH)
    parser.add_argument("--from-json", type=Path, help="Qualified fiches already parsed as a JSON list")
    parser.add_argument("--base-url", default=DIRECTORY_BASE_URL)
    args = parser.parse_args()
    if args.from_json:
        loaded = json.loads(args.from_json.read_text(encoding="utf-8"))
        entries = loaded["items"] if isinstance(loaded, dict) else loaded
        count = write_catalog(args.output, entries)
        print(f"Wrote {count} catalog entries to {args.output}")
        return
    result = refresh_catalog(args.output, base_url=args.base_url)
    print(result["message"])
    if not result["directory_available"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
