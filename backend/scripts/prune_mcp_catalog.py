"""Drop catalog fiches whose remote endpoint is unreachable or publishes no tool.

A 401 that asks for a user token stays. A 401 that only offers OAuth metadata is dropped:
this application cannot finish that login, so discovery would report the server as unreachable.
If every probe fails, the current snapshot is left unchanged.
"""

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.connectors.mcp_catalog import DEFAULT_CATALOG_PATH, prune_catalog


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_CATALOG_PATH)
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()

    def progress(done: int, total: int) -> None:
        if done == total or done % 50 == 0:
            print(f"{done}/{total}", flush=True)

    result = prune_catalog(
        args.output, workers=args.workers, progress=progress, allow_empty=False,
    )
    if result.get("skipped"):
        print("Aucune fiche joignable. L’instantané est conservé.")
        raise SystemExit(2)
    print(f"{result['kept']} fiches conservées, {result['removed']} écartées.")


if __name__ == "__main__":
    main()
