from typing import Any

import httpx
from agents import RunContextWrapper, function_tool

from app.connectors.context import ConnectorToolContext
from app.connectors.google_oauth import DRIVE_METADATA_READ_SCOPE, GoogleOAuthClient, GoogleOAuthError
from app.db import Database

DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"


class GoogleDriveError(RuntimeError):
    pass


async def fetch_drive_files(user_id: str, database: Database, oauth: GoogleOAuthClient,
                            query: str, http_client: httpx.AsyncClient | None = None) -> dict[str, object]:
    normalized_query = query.strip()
    if not normalized_query or len(normalized_query) > 100:
        raise ValueError("Drive search query must contain 1 to 100 characters")
    connection = database.get_connector_connection(user_id, "google_drive")
    if not connection or connection["status"] != "connected" or DRIVE_METADATA_READ_SCOPE not in connection["granted_scopes"]:
        raise PermissionError("Google Drive metadata permission is unavailable")
    escaped_query = normalized_query.replace("\\", "\\\\").replace("'", "\\'")
    try:
        token = await oauth.access_token(user_id, "google_drive")
        params = {
            "q": f"trashed = false and (name contains '{escaped_query}' or fullText contains '{escaped_query}')",
            "pageSize": "25", "orderBy": "modifiedTime desc",
            "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)",
        }
        if http_client:
            response = await http_client.get(DRIVE_FILES_URL, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=15)
        else:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(DRIVE_FILES_URL, headers={"Authorization": f"Bearer {token}"}, params=params)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, GoogleOAuthError) as error:
        if isinstance(error, httpx.HTTPStatusError) and error.response.status_code == 401:
            database.set_connector_connection(user_id, "google_drive", "error", connection["granted_scopes"], "Reconnexion Google requise")
        raise GoogleDriveError("Google Drive could not return file metadata") from error
    files = []
    for item in payload.get("files", []) if isinstance(payload.get("files", []), list) else []:
        if not isinstance(item, dict):
            continue
        files.append({key: item.get(key) for key in ("id", "name", "mimeType", "modifiedTime", "webViewLink")})
    return {"files": files, "next_page_token": payload.get("nextPageToken")}


@function_tool(name_override="drive_search_files", description_override="Search Google Drive by filename or text and return metadata only; it does not read file contents.", timeout=20)
async def drive_search_files(ctx: RunContextWrapper[ConnectorToolContext], query: str) -> dict[str, object]:
    """Find files using the connected user's Drive metadata read permission."""
    if ctx.context.google_oauth is None:
        raise GoogleDriveError("Google OAuth is unavailable")
    return await fetch_drive_files(ctx.context.user_id, ctx.context.database, ctx.context.google_oauth, query)
