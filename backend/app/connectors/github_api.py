import re

import httpx
from agents import RunContextWrapper, function_tool

from app.connectors.context import ConnectorToolContext
from app.connectors.github_oauth import GITHUB_API_BASE, GITHUB_READ_PERMISSIONS, GitHubAppOAuthClient, GitHubOAuthError
from app.db import Database

_REPOSITORY_PART = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_API_VERSION = "2026-03-10"


class GitHubApiError(RuntimeError):
    pass


def _require_connection(user_id: str, database: Database, required: set[str]) -> None:
    connection = database.get_connector_connection(user_id, "github")
    if not connection or connection["status"] != "connected" or not required.issubset(set(connection["granted_scopes"])):
        raise GitHubApiError("GitHub read permission is unavailable")


async def _github_get(user_id: str, database: Database, oauth: GitHubAppOAuthClient,
                      path: str, http_client: httpx.AsyncClient | None) -> httpx.Response:
    _require_connection(user_id, database, set(GITHUB_READ_PERMISSIONS))
    token = await oauth.access_token(user_id)
    headers = {
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": _API_VERSION,
    }
    url = f"{GITHUB_API_BASE}{path}"
    if http_client:
        response = await http_client.get(url, headers=headers, timeout=15)
    else:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, headers=headers)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 401:
            connection = database.get_connector_connection(user_id, "github")
            database.set_connector_connection(user_id, "github", "error", connection["granted_scopes"] if connection else [], "Reconnexion GitHub requise")
        raise GitHubApiError("GitHub could not return the requested data") from error
    return response


async def fetch_github_repositories(user_id: str, database: Database, oauth: GitHubAppOAuthClient,
                                    http_client: httpx.AsyncClient | None = None) -> dict[str, object]:
    try:
        response = await _github_get(user_id, database, oauth, "/user/repos?sort=updated&per_page=50", http_client)
        payload = response.json()
    except (httpx.HTTPError, GitHubOAuthError) as error:
        raise GitHubApiError("GitHub could not return repositories") from error
    repositories = []
    for item in payload if isinstance(payload, list) else []:
        if isinstance(item, dict):
            repositories.append({key: item.get(key) for key in ("full_name", "description", "private", "html_url", "updated_at", "default_branch")})
    return {"repositories": repositories}


async def fetch_github_issues(user_id: str, database: Database, oauth: GitHubAppOAuthClient,
                              owner: str, repository: str, http_client: httpx.AsyncClient | None = None) -> dict[str, object]:
    if not _REPOSITORY_PART.fullmatch(owner) or not _REPOSITORY_PART.fullmatch(repository):
        raise ValueError("A valid GitHub owner and repository are required")
    try:
        response = await _github_get(user_id, database, oauth, f"/repos/{owner}/{repository}/issues?state=all&per_page=50", http_client)
        payload = response.json()
    except (httpx.HTTPError, GitHubOAuthError) as error:
        raise GitHubApiError("GitHub could not return issues") from error
    issues = []
    for item in payload if isinstance(payload, list) else []:
        if not isinstance(item, dict) or "pull_request" in item:
            continue
        issues.append({key: (str(item.get(key, ""))[:2000] if key == "body" else item.get(key))
                       for key in ("number", "title", "state", "body", "html_url", "created_at", "updated_at")})
    return {"issues": issues}


@function_tool(name_override="github_list_repositories", description_override="List repositories the connected user can read through the GitHub App.", timeout=20)
async def github_list_repositories(ctx: RunContextWrapper[ConnectorToolContext]) -> dict[str, object]:
    """List repositories that are available to the connected account."""
    if not isinstance(ctx.context.github_oauth, GitHubAppOAuthClient):
        raise GitHubApiError("GitHub OAuth is unavailable")
    return await fetch_github_repositories(ctx.context.user_id, ctx.context.database, ctx.context.github_oauth)


@function_tool(name_override="github_list_issues", description_override="Read issues from a repository accessible to the connected GitHub account.", timeout=20)
async def github_list_issues(ctx: RunContextWrapper[ConnectorToolContext], owner: str, repository: str) -> dict[str, object]:
    """List repository issues without performing any write action."""
    if not isinstance(ctx.context.github_oauth, GitHubAppOAuthClient):
        raise GitHubApiError("GitHub OAuth is unavailable")
    return await fetch_github_issues(ctx.context.user_id, ctx.context.database, ctx.context.github_oauth, owner, repository)
