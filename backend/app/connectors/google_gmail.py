from typing import Any
from urllib.parse import quote

import httpx
from agents import RunContextWrapper, function_tool

from app.connectors.context import ConnectorToolContext
from app.connectors.google_oauth import GMAIL_READ_SCOPE, GoogleOAuthClient, GoogleOAuthError
from app.db import Database

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


class GmailError(RuntimeError):
    pass


async def fetch_gmail_messages(user_id: str, database: Database, oauth: GoogleOAuthClient,
                               query: str, http_client: httpx.AsyncClient | None = None) -> dict[str, object]:
    normalized_query = query.strip()
    if not normalized_query or len(normalized_query) > 200:
        raise ValueError("Gmail search query must contain 1 to 200 characters")
    connection = database.get_connector_connection(user_id, "gmail")
    if not connection or connection["status"] != "connected" or GMAIL_READ_SCOPE not in connection["granted_scopes"]:
        raise GmailError("Gmail read permission is unavailable")
    try:
        token = await oauth.access_token(user_id, "gmail")
        list_response = await _get(http_client, f"{GMAIL_API_BASE}/messages", token, params={"q": normalized_query, "maxResults": "20"})
        listed = list_response.json().get("messages", [])
        messages: list[dict[str, object]] = []
        for item in listed[:20] if isinstance(listed, list) else []:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                continue
            message_response = await _get(http_client, f"{GMAIL_API_BASE}/messages/{quote(item['id'], safe='')}", token, params={
                "format": "metadata", "metadataHeaders": ["From", "Subject", "Date"],
            })
            detail = message_response.json()
            header_values = {
                str(header.get("name", "")).lower(): str(header.get("value", ""))
                for header in detail.get("payload", {}).get("headers", [])
                if isinstance(header, dict)
            }
            messages.append({
                "id": detail.get("id"), "thread_id": detail.get("threadId"),
                "from": header_values.get("from", ""), "subject": header_values.get("subject", "Sans objet"),
                "date": header_values.get("date", str(detail.get("internalDate", ""))), "snippet": str(detail.get("snippet", ""))[:500],
            })
        return {"messages": messages}
    except (httpx.HTTPError, GoogleOAuthError, ValueError, KeyError) as error:
        if isinstance(error, httpx.HTTPStatusError) and error.response.status_code == 401:
            database.set_connector_connection(user_id, "gmail", "error", connection["granted_scopes"], "Reconnexion Google requise")
        raise GmailError("Gmail could not return messages") from error


async def _get(client: httpx.AsyncClient | None, url: str, token: str, params: dict[str, Any]) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"}
    if client is not None:
        response = await client.get(url, headers=headers, params=params, timeout=15)
    else:
        async with httpx.AsyncClient(timeout=15) as owned_client:
            response = await owned_client.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response


@function_tool(name_override="gmail_search_messages", description_override="Search connected Gmail messages and return only sender, subject, date and short snippet.", timeout=30)
async def gmail_search_messages(ctx: RunContextWrapper[ConnectorToolContext], query: str) -> dict[str, object]:
    """Search Gmail using a bounded Gmail query and return message summaries."""
    if ctx.context.google_oauth is None:
        raise GmailError("Google OAuth is unavailable")
    return await fetch_gmail_messages(ctx.context.user_id, ctx.context.database, ctx.context.google_oauth, query)
