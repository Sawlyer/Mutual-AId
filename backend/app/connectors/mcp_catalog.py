import hashlib
import json
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from app.config import BACKEND_DIR
from app.connectors.mcp_models import validate_public_endpoint


DEFAULT_CATALOG_PATH = BACKEND_DIR / "app" / "connectors" / "data" / "mcp_catalog.sqlite3"
DIRECTORY_BASE_URL = "https://mcpservers.org/fr/all"
CATALOG_PAGE_SIZE = 24
MAX_LISTING_PAGES = 700
_HOSTED_SECTION = re.compile(
    r"<h2[^>]*>\s*(?:Serveur MCP hébergé|Hosted MCP Server)\s*</h2>(?P<section>.*?)(?=<h2\b|$)",
    re.IGNORECASE | re.DOTALL,
)
_CODE = re.compile(r"<code[^>]*>(?P<code>.*?)</code>", re.IGNORECASE | re.DOTALL)
_ADD_MCP = re.compile(r"""npx\s+add-mcp\s+['"](?P<url>https?://[^'"]+)['"]""", re.IGNORECASE)
_RELATED = re.compile(
    r"<h2[^>]*>\s*(?:Serveurs connexes|Related servers|Sponsorisé|Sponsored)\s*</h2>",
    re.IGNORECASE,
)
_NO_KEY = re.compile(r"sans\s+cl[ée]|no\s+api\s+key|aucun\s+compte|no\s+account", re.IGNORECASE)
_PAID_SERVER = re.compile(
    r"x402|\busdc\b|payant|(?<!sans )paiements?(?:\s+(?:à|a)\s+l['’]appel)?|pricing|subscription|abonnement|"
    r"pay[- ]per|pay[- ]?as[- ]you[- ]go|per[- ](?:request|call)|vous\s+payez|you\s+pay|"
    r"stripe|\bbilling\b|factur(?:é|és|ation)\s+(?:à|a|par|basée|basee)|"
    r"freemium|free\s+tier|niveau\s+gratuit|plan\s+gratuit|gratuit\s+pour\s+commencer|"
    r"cr[ée]dits?\s+(?:de\s+compte|api|prépay|prepay|n['’]expirent)|"
    r"(?:uses?|utilise|utilisent|dépense|coûte|costs?)\s+(?:des\s+|vos\s+|your\s+)?cr[ée]dits?\b|"
    r"\d+\s+cr[ée]dits?\b|cr[ée]dits?\s+(?:par|per|/)\s|"
    r"(?:\$|€)\s*\d|\d+(?:[.,]\d+)?\s*(?:usdc|usd|eur)\b|"
    r"\d+(?:[.,]\d+)?\s*(?:\$|€)\s*(?:/|par\b)|à\s+partir\s+de\s+\d+(?:[.,]\d+)?\s*(?:\$|€)",
    re.IGNORECASE,
)
_STOPWORDS = {
    "les", "des", "une", "pour", "avec", "dans", "sur", "que", "qui", "pas", "plus",
    "mon", "mes", "nous", "vous", "cette", "cet", "aux", "par", "est", "son", "ses",
    "leur", "leurs", "du", "de", "la", "le", "un", "et", "ou", "en", "au", "ce",
    "the", "and", "for", "with", "from", "your", "notre",
}
_GENERIC_MCP_TERMS = {
    "data", "donnees", "données", "info", "infos", "information", "informations",
    "mcp", "server", "serveur", "serveurs", "remote", "api", "tool", "tools",
    "prix", "price", "actuel", "current", "blockchain", "finance", "market",
    "marché", "marche", "token", "tokens", "développement", "developpement",
}
_CARD_LINK = re.compile(r'<a\s+href="(?P<href>[^"]+)"[^>]*>(?P<body>.*?)</a>', re.IGNORECASE | re.DOTALL)
_TITLE = re.compile(
    r'data-slot="card-title"[^>]*>(?P<name>.*?)</div>\s*<div[^>]*>(?P<category>.*?)</div>',
    re.IGNORECASE | re.DOTALL,
)
_DESCRIPTION = re.compile(r'data-slot="card-description"[^>]*>(?P<description>.*?)</div>', re.IGNORECASE | re.DOTALL)
_BADGE = re.compile(r'rounded-full[^>]*>(?P<label>[^<]+)</span>', re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
_TOKEN = re.compile(r"[0-9A-Za-zÀ-ÿ]{3,}", re.UNICODE)


def parse_listing_html(html: str) -> list[dict[str, object]]:
    """Read public directory cards. Descriptions may mention URLs; they are never used as endpoints."""
    entries: list[dict[str, object]] = []
    for match in _CARD_LINK.finditer(html):
        body = match.group("body")
        if 'data-slot="card"' not in body:
            continue
        title = _TITLE.search(body)
        if title is None:
            continue
        name = _clean_text(title.group("name"))
        if not name:
            continue
        description_match = _DESCRIPTION.search(body)
        description = _clean_text(description_match.group("description") if description_match else "")[:2000]
        badges: list[str] = []
        for badge in _BADGE.finditer(body):
            label = _clean_text(badge.group("label")).lower()
            if label == "official":
                label = "officiel"
            if label in {"sponsor", "officiel"} and label not in badges:
                badges.append(label)
        entry_id, source_url = _public_source(match.group("href"), name)
        entries.append({
            "id": entry_id,
            "name": name[:200],
            "description": description,
            "category": _clean_text(title.group("category"))[:80] or "Autre",
            "source_url": source_url,
            "badges": badges,
        })
    return entries


def parse_detail_html(html: str, description: str = "") -> dict[str, object] | None:
    """Return the publisher's remote URL, or nothing when the fiche has no hosted public endpoint."""
    hosted = _HOSTED_SECTION.search(html)
    if hosted is None:
        return None
    endpoint = ""
    for code in _CODE.finditer(hosted.group("section")):
        matched = _ADD_MCP.search(unescape(code.group("code")))
        if matched is None:
            continue
        try:
            endpoint = validate_public_endpoint(matched.group("url").strip(), resolve=False)
        except ValueError:
            return None
        break
    if not endpoint:
        return None
    visible = _RELATED.split(html, maxsplit=1)[0]
    lead = html[:hosted.start()]
    requires_token = not bool(_NO_KEY.search(description) or _NO_KEY.search(_clean_text(lead))) and (
        "Authorization" in _clean_text(visible) or "Bearer" in _clean_text(visible)
    )
    return {"endpoint": endpoint, "requires_token": requires_token}


def is_free_server(entry: dict[str, object]) -> bool:
    """A server is free when its published name and description do not ask for payment."""
    text = f"{entry.get('name', '')} {entry.get('description', '')}"
    return _PAID_SERVER.search(text) is None


def qualify_listing_entry(entry: dict[str, object], detail_html: str) -> dict[str, object] | None:
    hosted = parse_detail_html(detail_html, description=str(entry.get("description") or ""))
    if hosted is None:
        return None
    qualified = dict(entry)
    qualified.update(hosted)
    return qualified


PROBE_TIMEOUT_SECONDS = 4.0
_PROTOCOL_VERSION = "2025-03-26"
_KEEP_VERDICTS = frozenset({"tools", "auth"})


def probe_remote_tools(
    endpoint: str, *, timeout: float = PROBE_TIMEOUT_SECONDS, client=None,
) -> str:
    """Return tools, auth, or empty. Empty means unreachable, not MCP, no tool, or OAuth-only."""
    try:
        endpoint = validate_public_endpoint(endpoint, resolve=True)
    except ValueError:
        return "empty"
    owns_client = client is None
    if owns_client:
        import httpx
        client = httpx.Client(timeout=timeout, follow_redirects=False)
    try:
        return _probe_open_client(client, endpoint)
    except Exception:
        return "empty"
    finally:
        if owns_client:
            client.close()


def prune_catalog(
    path: Path, *, probe=None, workers: int = 16, progress=None, allow_empty: bool = True,
) -> dict[str, object]:
    """Rewrite the snapshot without endpoints that are unreachable or publish no tool."""
    entries = McpCatalog(path).entries()
    verdicts = _probe_many(
        [str(entry.get("endpoint") or "") for entry in entries],
        probe or probe_remote_tools,
        max(1, workers),
        progress,
    )
    kept = [entry for entry, verdict in zip(entries, verdicts) if verdict in _KEEP_VERDICTS]
    removed = len(entries) - len(kept)
    if entries and not kept and not allow_empty:
        return {"kept": len(entries), "removed": 0, "skipped": True}
    if removed:
        write_catalog(path, kept)
    return {"kept": len(kept), "removed": removed, "skipped": False}


class DirectoryRefused(Exception):
    """The public directory returned a challenge instead of pages."""


def refresh_catalog(path: Path, *, base_url: str = DIRECTORY_BASE_URL, fetch=None, probe=None) -> dict[str, object]:
    """Add newly published remote fiches. A directory challenge leaves the current snapshot untouched."""
    client = None
    if fetch is None:
        import httpx
        client = httpx.Client(timeout=30, follow_redirects=False, headers={"Accept": "text/html", "Accept-Language": "fr"})

        def fetch(url: str) -> tuple[int, str]:
            try:
                response = client.get(url)
            except httpx.HTTPError as error:
                raise DirectoryRefused from error
            return response.status_code, response.text
    try:
        try:
            fresh = collect_new_remote_entries(
                fetch, McpCatalog(path).ids(), base_url, probe=probe or probe_remote_tools,
            )
        except DirectoryRefused:
            return {
                "added": 0,
                "directory_available": False,
                "message": "Le répertoire n’a pas répondu. La liste actuelle est conservée.",
            }
        added = append_catalog(path, fresh)
        if added == 1:
            message = "1 nouvelle fiche."
        elif added:
            message = f"{added} nouvelles fiches."
        else:
            message = "Aucune nouvelle fiche."
        return {"added": added, "directory_available": True, "message": message}
    finally:
        if client is not None:
            client.close()


def collect_new_remote_entries(
    fetch, existing_ids: set[str], base_url: str = DIRECTORY_BASE_URL, *, probe=None,
) -> list[dict[str, object]]:
    listings: list[dict[str, object]] = []
    for page in range(1, MAX_LISTING_PAGES + 1):
        status, text = fetch(_page_url(base_url, page))
        if status == 404 and page > 1:
            break
        if _directory_refused(status, text):
            raise DirectoryRefused
        parsed = parse_listing_html(text)
        if not parsed:
            break
        listings.extend(parsed)
    fresh: list[dict[str, object]] = []
    seen = set(existing_ids)
    for entry in listings:
        entry_id = str(entry["id"])
        if entry_id in seen:
            continue
        seen.add(entry_id)
        status, text = fetch(str(entry["source_url"]))
        if status == 404:
            continue
        if _directory_refused(status, text):
            raise DirectoryRefused
        qualified = qualify_listing_entry(entry, text)
        if qualified is None:
            continue
        if _listing_is_reachable(str(qualified["endpoint"]), probe or probe_remote_tools):
            fresh.append(qualified)
    return fresh


def _listing_is_reachable(endpoint: str, probe) -> bool:
    return _safe_verdict(probe, endpoint) in _KEEP_VERDICTS


def _probe_many(endpoints: list[str], probe, workers: int, progress) -> list[str]:
    if not endpoints:
        return []
    if workers == 1:
        verdicts: list[str] = []
        for index, endpoint in enumerate(endpoints, start=1):
            verdicts.append(_safe_verdict(probe, endpoint))
            if progress is not None:
                progress(index, len(endpoints))
        return verdicts
    verdicts = ["empty"] * len(endpoints)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_safe_verdict, probe, endpoint): index
            for index, endpoint in enumerate(endpoints)
        }
        done = 0
        for future in as_completed(futures):
            verdicts[futures[future]] = future.result()
            done += 1
            if progress is not None:
                progress(done, len(endpoints))
    return verdicts


def _safe_verdict(probe, endpoint: str) -> str:
    try:
        verdict = probe(endpoint)
    except Exception:
        return "empty"
    return verdict if verdict in {"tools", "auth", "empty"} else "empty"


def _probe_open_client(client, endpoint: str) -> str:
    opened = client.post(endpoint, headers=_probe_headers(), json=_initialize_body())
    if opened.status_code == 401:
        return _challenge_verdict(opened)
    if opened.status_code != 200 or not _jsonrpc_payloads(opened.text):
        return "empty"
    headers = _probe_headers(session=_session_id(opened.headers))
    client.post(
        endpoint, headers=headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    listed = client.post(
        endpoint, headers=headers,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    )
    if listed.status_code == 401:
        return _challenge_verdict(listed)
    if listed.status_code != 200:
        return "empty"
    count = _tool_count(_jsonrpc_payloads(listed.text))
    if not count:
        return "empty"
    return "tools"


def _challenge_verdict(response) -> str:
    """A pasted token can unlock a 401. An OAuth metadata challenge cannot be finished here."""
    header = response.headers.get("www-authenticate", "")
    body = getattr(response, "text", "")
    header_text = header if isinstance(header, str) else ""
    body_text = body[:4000] if isinstance(body, str) else ""
    folded = f"{header_text}\n{body_text}".casefold()
    if "resource_metadata" in folded or "authorization_servers" in folded:
        return "empty"
    return "auth"


def _initialize_body() -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "mutual-aid", "version": "0"},
        },
    }


def _probe_headers(session: str = "") -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": _PROTOCOL_VERSION,
    }
    if session:
        headers["mcp-session-id"] = session
    return headers


def _session_id(headers) -> str:
    value = headers.get("mcp-session-id", "")
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if not value or len(value) > 200 or any(char.isspace() for char in value):
        return ""
    return value


def _jsonrpc_payloads(body: str) -> list[dict[str, object]]:
    text = body.strip()
    if not text:
        return []
    if text[0] in "{[":
        return _json_payloads(text)
    payloads: list[dict[str, object]] = []
    data: list[str] = []

    def flush() -> None:
        if not data:
            return
        raw = "\n".join(data)
        data.clear()
        payloads.extend(_json_payloads(raw))

    for line in body.splitlines():
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line.strip():
            flush()
    flush()
    return payloads


def _json_payloads(raw: str) -> list[dict[str, object]]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _named_tool(tool: object) -> bool:
    return isinstance(tool, dict) and isinstance(tool.get("name"), str) and bool(tool["name"].strip())


def _tool_count(payloads: list[dict[str, object]]) -> int | None:
    for payload in payloads:
        result = payload.get("result")
        if not isinstance(result, dict) or "tools" not in result:
            continue
        tools = result.get("tools")
        if not isinstance(tools, list):
            return 0
        return sum(1 for tool in tools if _named_tool(tool))
    return None


def append_catalog(path: Path, entries: list[dict[str, object]]) -> int:
    current = McpCatalog(path).entries()
    known = {str(item["id"]) for item in current}
    fresh = [entry for entry in entries if str(entry.get("id")) not in known]
    if not fresh:
        return 0
    write_catalog(path, [*current, *fresh])
    return len(_storable(fresh))


def write_catalog(path: Path, entries: list[dict[str, object]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".sqlite3.tmp")
    if temporary.exists():
        temporary.unlink()
    connection = sqlite3.connect(temporary)
    try:
        connection.executescript(
            """
            CREATE TABLE mcp_catalog (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                source_url TEXT NOT NULL,
                badges_json TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                requires_token INTEGER NOT NULL
            );
            CREATE INDEX mcp_catalog_category ON mcp_catalog(category, name);
            CREATE VIRTUAL TABLE mcp_catalog_fts USING fts5(
                name, description, category,
                content='mcp_catalog',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            );
            """
        )
        stored = _storable(entries)
        connection.executemany(
            """INSERT INTO mcp_catalog
               (id, name, description, category, source_url, badges_json, endpoint, requires_token)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            stored,
        )
        connection.execute("INSERT INTO mcp_catalog_fts(mcp_catalog_fts) VALUES ('rebuild')")
        connection.commit()
    finally:
        connection.close()
    temporary.replace(path)
    return len(stored)


class McpCatalog:
    def __init__(self, path: Path = DEFAULT_CATALOG_PATH) -> None:
        self.path = path

    def charges_for_endpoint(self, url: str) -> bool:
        candidate = url.strip().rstrip("/")
        if not candidate:
            return False
        with self._connection() as connection:
            if connection is None or not _has_endpoint(connection):
                return False
            rows = connection.execute(
                "SELECT * FROM mcp_catalog WHERE rtrim(endpoint, '/') = ?",
                (candidate,),
            ).fetchall()
        return any(not is_free_server(_entry(row)) for row in rows)

    def get(self, catalog_id: str) -> dict[str, object] | None:
        with self._connection() as connection:
            if connection is None or not _has_endpoint(connection):
                return None
            row = connection.execute("SELECT * FROM mcp_catalog WHERE id = ?", (catalog_id,)).fetchone()
        return _entry(row) if row else None

    def ids(self) -> set[str]:
        return {str(entry["id"]) for entry in self.entries()}

    def entries(self) -> list[dict[str, object]]:
        with self._connection() as connection:
            if connection is None or not _has_endpoint(connection):
                return []
            rows = connection.execute("SELECT * FROM mcp_catalog ORDER BY name").fetchall()
        return [_entry(row) for row in rows]

    def categories(self) -> list[str]:
        names = {
            str(entry["category"]) for entry in self.entries()
            if is_free_server(entry) and entry.get("category")
        }
        return sorted(names)

    def search(self, query: str = "", category: str = "", page: int = 1, page_size: int = CATALOG_PAGE_SIZE) -> tuple[list[dict[str, object]], int]:
        page = max(1, page)
        page_size = min(max(1, page_size), 48)
        with self._connection() as connection:
            if connection is None or not _has_endpoint(connection):
                return [], 0
            match = _fts_query(query, operator="AND")
            if match and _has_fts(connection):
                rows = connection.execute(
                    """SELECT mcp_catalog.* FROM mcp_catalog_fts
                       JOIN mcp_catalog ON mcp_catalog.rowid = mcp_catalog_fts.rowid
                       WHERE mcp_catalog_fts MATCH ? AND (? = '' OR mcp_catalog.category = ?)
                       ORDER BY bm25(mcp_catalog_fts), mcp_catalog.name""",
                    (match, category, category),
                ).fetchall()
            else:
                like = _like_pattern(query)
                rows = connection.execute(
                    """SELECT * FROM mcp_catalog
                       WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')
                         AND (? = '' OR category = ?)
                       ORDER BY name""",
                    (query.strip(), like, like, like, category, category),
                ).fetchall()
        free = [entry for row in rows if is_free_server(entry := _entry(row))]
        offset = (page - 1) * page_size
        return free[offset:offset + page_size], len(free)

    def suggest(self, content: str, excluded_ids: set[str], limit: int = 3) -> list[dict[str, object]]:
        match = _fts_query(content, operator="OR")
        if not match:
            return []
        with self._connection() as connection:
            if connection is None or not _has_endpoint(connection) or not _has_fts(connection):
                return []
            rows = connection.execute(
                """SELECT mcp_catalog.* FROM mcp_catalog_fts
                   JOIN mcp_catalog ON mcp_catalog.rowid = mcp_catalog_fts.rowid
                   WHERE mcp_catalog_fts MATCH ?
                   ORDER BY bm25(mcp_catalog_fts) LIMIT 12""",
                (match,),
            ).fetchall()
        suggestions = []
        for row in rows:
            entry = _entry(row)
            if entry["id"] in excluded_ids or not is_free_server(entry):
                continue
            suggestions.append({"id": entry["id"], "name": entry["name"], "category": entry["category"]})
            if len(suggestions) >= limit:
                break
        return suggestions

    def servers_needed(self, content: str, excluded_ids: set[str], limit: int = 3) -> list[dict[str, object]]:
        """Return catalog servers whose name matches a specific term in the request."""
        specific_tokens, generic_tokens = _query_tokens(content)
        if not specific_tokens:
            return []
        match = _fts_query(" ".join(specific_tokens), operator="OR")
        if not match:
            return []
        with self._connection() as connection:
            if connection is None or not _has_endpoint(connection) or not _has_fts(connection):
                return []
            rows = list(connection.execute(
                """SELECT mcp_catalog.* FROM mcp_catalog_fts
                   JOIN mcp_catalog ON mcp_catalog.rowid = mcp_catalog_fts.rowid
                   WHERE mcp_catalog_fts MATCH ?
                   ORDER BY bm25(mcp_catalog_fts), mcp_catalog.name LIMIT 80""",
                (match,),
            ).fetchall())
            for token in specific_tokens:
                rows.extend(connection.execute(
                    "SELECT * FROM mcp_catalog WHERE lower(name) = ?",
                    (token,),
                ).fetchall())
        seen: set[str] = set()
        ranked: list[tuple[tuple[int, int, int], str, dict[str, object]]] = []
        for row in rows:
            entry = _entry(row)
            if entry["id"] in seen or entry["id"] in excluded_ids or not is_free_server(entry):
                continue
            seen.add(str(entry["id"]))
            rank = _name_match_rank(str(entry["name"]), specific_tokens, generic_tokens)
            if rank is None:
                continue
            ranked.append((rank, str(entry["name"]).casefold(), entry))
        if not ranked:
            return []
        ranked.sort(key=lambda item: (-item[0][0], -item[0][1], -item[0][2], item[1]))
        best = ranked[0][0]
        return [entry for rank, _name, entry in ranked if rank == best][:limit]

    def _connection(self):
        return _read_only(self.path)


class _read_only:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.connection: sqlite3.Connection | None = None

    def __enter__(self) -> sqlite3.Connection | None:
        if not self.path.is_file():
            return None
        self.connection = sqlite3.connect(f"{self.path.resolve().as_uri()}?mode=ro", uri=True)
        self.connection.row_factory = sqlite3.Row
        return self.connection

    def __exit__(self, *args) -> None:
        if self.connection is not None:
            self.connection.close()


def _storable(entries: list[dict[str, object]]) -> list[tuple[object, ...]]:
    unique: dict[str, dict[str, object]] = {}
    for entry in entries:
        unique.setdefault(str(entry["id"]), entry)
    stored: list[tuple[object, ...]] = []
    for item in unique.values():
        try:
            endpoint = validate_public_endpoint(str(item.get("endpoint") or ""), resolve=False)
        except ValueError:
            continue
        badges = item.get("badges") or []
        stored.append((
            item["id"], item["name"], item["description"], item["category"], item["source_url"],
            json.dumps(badges, ensure_ascii=False), endpoint, 1 if item.get("requires_token") else 0,
        ))
    return stored


def _has_endpoint(connection: sqlite3.Connection) -> bool:
    rows = connection.execute("PRAGMA table_info(mcp_catalog)").fetchall()
    return any(row["name"] == "endpoint" for row in rows)


def _directory_refused(status: int, text: str) -> bool:
    return status != 200 or "Just a moment" in text or "cf-challenge" in text


def _page_url(base_url: str, page: int) -> str:
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}page={page}"


def _has_fts(connection: sqlite3.Connection) -> bool:
    row = connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mcp_catalog_fts'").fetchone()
    return row is not None


def _entry(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "category": row["category"],
        "source_url": row["source_url"],
        "badges": json.loads(row["badges_json"]),
        "endpoint": row["endpoint"],
        "requires_token": bool(row["requires_token"]),
    }


def _like_pattern(query: str) -> str:
    escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _query_tokens(text: str) -> tuple[list[str], list[str]]:
    specific: list[str] = []
    generic: list[str] = []
    for token in _TOKEN.findall(text.casefold()):
        if token in _STOPWORDS or len(token) < 4:
            continue
        target = generic if token in _GENERIC_MCP_TERMS else specific
        if token not in target:
            target.append(token)
        if len(specific) + len(generic) == 8:
            break
    return specific, generic


def _name_has_token(name: str, token: str) -> bool:
    return re.search(rf"(?<![0-9a-zà-ÿ]){re.escape(token)}(?![0-9a-zà-ÿ])", name.casefold()) is not None


def _name_match_rank(name: str, specific_tokens: list[str], generic_tokens: list[str]) -> tuple[int, int, int] | None:
    matched = [token for token in specific_tokens if _name_has_token(name, token)]
    if not matched:
        return None
    exact = int(name.casefold() in matched)
    longest = max(len(token) for token in matched)
    hits = len(matched) + sum(1 for token in generic_tokens if _name_has_token(name, token))
    return exact, longest, hits


def _fts_query(text: str, operator: str) -> str:
    tokens: list[str] = []
    for token in _TOKEN.findall(text.casefold()):
        if token in _STOPWORDS or token in tokens:
            continue
        tokens.append(token.replace('"', ""))
        if len(tokens) == 8:
            break
    if not tokens:
        return ""
    return f" {operator} ".join(f'"{token}"' for token in tokens)


def _clean_text(value: str) -> str:
    return unescape(_TAGS.sub("", value)).replace("\xa0", " ").strip()


def _public_source(href: str, name: str) -> tuple[str, str]:
    parsed = urlsplit(unescape(href.strip()))
    path = parsed.path or ""
    if "/servers/" in path:
        slug = path.split("/servers/", 1)[1].strip("/")[:180]
        return slug or _external_id(parsed.hostname or "fiche", name), f"https://mcpservers.org{path}"
    host = (parsed.hostname or "fiche").lower()
    source = urlunsplit((parsed.scheme or "https", parsed.netloc, path, "", ""))
    return _external_id(host, name), source[:2048]


def _external_id(host: str, name: str) -> str:
    digest = hashlib.sha256(f"{host}\n{name}".encode()).hexdigest()[:16]
    return f"ext-{digest}"
