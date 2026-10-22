from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from agents import RunContextWrapper, function_tool

from app.connectors.google_oauth import CALENDAR_READ_SCOPE, GoogleOAuthClient, GoogleOAuthError
from app.db import Database

CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


class GoogleCalendarError(RuntimeError):
    pass


def _parse_rfc3339(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("A time zone offset is required")
    return parsed.astimezone(timezone.utc)


async def fetch_calendar_events(
    user_id: str,
    database: Database,
    oauth: GoogleOAuthClient,
    time_min: str,
    time_max: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, object]:
    start = _parse_rfc3339(time_min)
    end = _parse_rfc3339(time_max)
    if end <= start or end - start > timedelta(days=90):
        raise ValueError("Calendar range must be positive and no longer than 90 days")
    connection = database.get_connector_connection(user_id, "google_calendar")
    if not connection or connection["status"] != "connected" or CALENDAR_READ_SCOPE not in connection["granted_scopes"]:
        raise GoogleCalendarError("Google Calendar read permission is unavailable")
    try:
        token = await oauth.access_token(user_id)
        params = {
            "timeMin": time_min, "timeMax": time_max, "singleEvents": "true", "orderBy": "startTime",
            "maxResults": "100", "fields": "items(id,summary,start,end,status),nextPageToken",
        }
        if http_client:
            response = await http_client.get(CALENDAR_EVENTS_URL, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=15)
        else:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(CALENDAR_EVENTS_URL, headers={"Authorization": f"Bearer {token}"}, params=params)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, GoogleOAuthError) as error:
        if isinstance(error, httpx.HTTPStatusError) and error.response.status_code == 401:
            database.set_connector_connection(user_id, "google_calendar", "error", connection["granted_scopes"], "Reconnexion Google requise")
        raise GoogleCalendarError("Google Calendar could not return events") from error
    items = payload.get("items", [])
    safe_events = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        safe_events.append({
            "id": item.get("id"),
            "summary": item.get("summary", "Sans titre"),
            "start": item.get("start"),
            "end": item.get("end"),
            "status": item.get("status", "confirmed"),
        })
    return {"items": safe_events, "next_page_token": payload.get("nextPageToken")}


@dataclass
class CalendarToolContext:
    user_id: str
    database: Database
    oauth: GoogleOAuthClient
    http_client: httpx.AsyncClient | None = None


@function_tool(
    name_override="calendar_list_events",
    description_override="Read the connected user's Google Calendar events in an explicit date range. Returns only event title, start, end, and status.",
    timeout=20,
)
async def calendar_list_events(
    ctx: RunContextWrapper[CalendarToolContext], time_min: str, time_max: str
) -> dict[str, object]:
    """List events between two RFC3339 timestamps, with a maximum range of 90 days."""
    return await fetch_calendar_events(
        ctx.context.user_id, ctx.context.database, ctx.context.oauth, time_min, time_max, ctx.context.http_client
    )
