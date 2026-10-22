import asyncio
import json
import logging
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from app.auth import create_session, hash_password, token_digest, verify_password

from app.agent import configure_openai, stream_assistant
from app.agents.models import AgentProfileCreate, AgentProfileRead, AgentProfileUpdate
from app.agents.service import AgentService
from app.executions.coordinator import ExecutionCoordinator
from app.executions.repository import ExecutionRepository
from app.planning.router import RequestRouter
from app.planning.schemas import PlanningRequest, PlanValidationError
from app.planning.service import Planner, PlanningUnavailable
from app.connectors.registry import ConnectorRegistry
from app.connectors.base import Connector, ConnectorPermission, ToolAccess, ToolDescriptor, UnavailableAuthProvider
from app.connectors.tools import ConnectorAuthorizationError, ToolRegistry
from app.connectors.google_calendar import calendar_list_events
from app.connectors.google_drive import drive_search_files
from app.connectors.google_gmail import gmail_search_messages
from app.connectors.google_oauth import CALENDAR_READ_SCOPE, DRIVE_METADATA_READ_SCOPE, GOOGLE_CONNECTOR_SCOPES, GMAIL_READ_SCOPE, GoogleOAuthClient, GoogleOAuthNotConfigured, InvalidOAuthState
from app.connectors.github_api import github_list_issues, github_list_repositories
from app.connectors.github_oauth import GITHUB_READ_PERMISSIONS, GitHubAppOAuthClient, GitHubOAuthNotConfigured
from app.connectors.context import ConnectorToolContext
from app.connectors.oauth import OAuthStateStore, TokenVault
from app.connectors.mcp_models import McpServerCreate, McpServerRead, McpServerUpdateTools, validate_public_endpoint
from app.connectors.mcp_service import McpService
from app.connectors.mcp_runtime import MCP_CONNECTOR_PREFIX, McpAuthorizationError, McpRuntime
from app.config import Settings
from app.db import Database
from app.schemas import (
    ConversationCreate,
    ConversationRead,
    ConversationRename,
    AuthLogin,
    AuthRegister,
    AuthUserRead,
    AgentCatalogRead,
    ApprovalDecision,
    AnalyticsRead,
    ConnectorPreferencesRead,
    ConnectorPreferencesUpdate,
    ConnectorRead,
    HealthRead,
    MessageCreate,
    MessageRead,
)

logger = logging.getLogger("mutual_aid.api")
router = APIRouter(prefix="/api")


class RequestLimiter:
    def __init__(self, limit: int, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self.requests: dict[str, deque[float]] = defaultdict(deque)

    def check(self, client_key: str) -> bool:
        now = time.monotonic()
        timestamps = self.requests[client_key]
        while timestamps and timestamps[0] <= now - self.window_seconds:
            timestamps.popleft()
        if len(timestamps) >= self.limit:
            return False
        timestamps.append(now)
        return True


def rate_limit(request: Request) -> None:
    client_key = request.client.host if request.client else "unknown"
    if not request.app.state.rate_limiter.check(client_key):
        raise HTTPException(status_code=429, detail="Trop de requêtes. Réessayez dans une minute.")


def sse_event(event: str, payload: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"


def get_database(request: Request) -> Database:
    return request.app.state.database


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


Db = Annotated[Database, Depends(get_database)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def current_user(request: Request, database: Db, settings: AppSettings) -> AuthUserRead:
    token = request.cookies.get(settings.auth_cookie_name)
    user = database.get_user_for_session(token_digest(token)) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Connectez-vous pour continuer.")
    return user


CurrentUser = Annotated[AuthUserRead, Depends(current_user)]


def agent_service(database: Db) -> AgentService:
    return AgentService(database)


def trusted_origin(request: Request, settings: AppSettings) -> None:
    origin = request.headers.get("origin")
    if origin and origin not in settings.allowed_origins:
        raise HTTPException(status_code=403, detail="Origine non autorisée.")


TrustedOrigin = Depends(trusted_origin)


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        settings.auth_cookie_name, token, max_age=settings.auth_session_days * 86400,
        httponly=True, secure=settings.auth_cookie_secure, samesite="lax", path="/api",
    )


@router.post("/auth/register", response_model=AuthUserRead, status_code=201, dependencies=[Depends(rate_limit), TrustedOrigin])
async def register(payload: AuthRegister, response: Response, database: Db, settings: AppSettings) -> AuthUserRead:
    if database.get_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="Un compte utilise déjà cette adresse e-mail.")
    try:
        user = database.create_user(payload.email, payload.name, hash_password(payload.password))
    except Exception as error:
        if database.get_user_by_email(payload.email):
            raise HTTPException(status_code=409, detail="Un compte utilise déjà cette adresse e-mail.") from error
        raise
    set_session_cookie(response, create_session(database, user, settings), settings)
    return user


@router.post("/auth/login", response_model=AuthUserRead, dependencies=[Depends(rate_limit), TrustedOrigin])
async def login(payload: AuthLogin, response: Response, database: Db, settings: AppSettings) -> AuthUserRead:
    account = database.get_user_by_email(payload.email)
    if not verify_password(payload.password, account["password_hash"] if account else None) or account is None:
        raise HTTPException(status_code=401, detail="Adresse e-mail ou mot de passe incorrect.")
    user = database.get_user(account["id"])
    assert user is not None
    set_session_cookie(response, create_session(database, user, settings), settings)
    return user


@router.get("/auth/me", response_model=AuthUserRead)
async def auth_me(user: CurrentUser) -> AuthUserRead:
    return user


@router.post("/auth/logout", status_code=204, dependencies=[Depends(rate_limit), TrustedOrigin])
async def logout(request: Request, response: Response, database: Db, settings: AppSettings, user: CurrentUser) -> Response:
    token = request.cookies.get(settings.auth_cookie_name)
    if token:
        database.delete_auth_session(token_digest(token))
    response.delete_cookie(settings.auth_cookie_name, path="/api", httponly=True, secure=settings.auth_cookie_secure, samesite="lax")
    response.status_code = 204
    return response


@router.get("/health", response_model=HealthRead, summary="Vérifier la disponibilité du backend")
async def health(settings: AppSettings) -> HealthRead:
    return HealthRead(
        openai_configured=settings.openai_configured,
        model_configured=bool(settings.openai_model and settings.openai_model.strip()),
    )


@router.get("/analytics", response_model=AnalyticsRead, summary="Lire les statistiques du compte")
async def get_analytics(database: Db, user: CurrentUser) -> AnalyticsRead:
    return AnalyticsRead(**database.get_user_analytics(user.id))


@router.get("/agents", response_model=AgentCatalogRead, summary="Lister les profils et compétences d’agents")
async def list_agents(service: Annotated[AgentService, Depends(agent_service)], user: CurrentUser) -> AgentCatalogRead:
    return AgentCatalogRead(profiles=service.list_profiles(user.id), capabilities=service.capabilities())


@router.post("/agents", response_model=AgentProfileRead, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit), TrustedOrigin], summary="Créer un profil d’agent")
async def create_agent(payload: AgentProfileCreate, service: Annotated[AgentService, Depends(agent_service)], user: CurrentUser) -> AgentProfileRead:
    supported = {capability.id for capability in service.capabilities()}
    if not set(payload.capability_ids).issubset(supported):
        raise HTTPException(status_code=422, detail="Une compétence demandée n’est pas prise en charge.")
    return service.create_profile(user.id, payload)


@router.get("/agents/{profile_id}", response_model=AgentProfileRead, summary="Consulter un profil d’agent")
async def get_agent(profile_id: str, service: Annotated[AgentService, Depends(agent_service)], user: CurrentUser) -> AgentProfileRead:
    profile = service.get_profile(user.id, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profil introuvable.")
    return profile


@router.patch("/agents/{profile_id}", response_model=AgentProfileRead,
              dependencies=[Depends(rate_limit), TrustedOrigin], summary="Modifier un profil d’agent")
async def update_agent(profile_id: str, payload: AgentProfileUpdate, service: Annotated[AgentService, Depends(agent_service)], user: CurrentUser) -> AgentProfileRead:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    supported = {capability.id for capability in service.capabilities()}
    if not set(changes.get("capability_ids", [])).issubset(supported):
        raise HTTPException(status_code=422, detail="Une compétence demandée n’est pas prise en charge.")
    profile = service.update_profile(user.id, profile_id, payload)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profil introuvable.")
    return profile


@router.delete("/agents/{profile_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(rate_limit), TrustedOrigin], summary="Supprimer un profil d’agent")
async def delete_agent(profile_id: str, service: Annotated[AgentService, Depends(agent_service)], user: CurrentUser) -> Response:
    if not service.delete_profile(user.id, profile_id):
        raise HTTPException(status_code=404, detail="Profil introuvable.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/executions/{execution_id}", summary="Inspecter une exécution")
async def get_execution(execution_id: str, request: Request, user: CurrentUser):
    execution = request.app.state.execution_repository.get(user.id, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Exécution introuvable.")
    return execution


@router.get("/executions", summary="Lister les exécutions de l’utilisateur")
async def list_executions(request: Request, user: CurrentUser):
    return request.app.state.execution_repository.list_executions(user.id)


@router.get("/executions/{execution_id}/events", summary="Relire les événements d’une exécution")
async def get_execution_events(execution_id: str, request: Request, user: CurrentUser, after_id: Annotated[int | None, Query(ge=0)] = None):
    if request.app.state.execution_repository.get(user.id, execution_id) is None:
        raise HTTPException(status_code=404, detail="Exécution introuvable.")
    return request.app.state.execution_repository.list_events(user.id, execution_id, after_id)


@router.post("/executions/{execution_id}/approvals/{approval_id}", summary="Approuver ou refuser une action")
async def decide_execution_approval(execution_id: str, approval_id: str, payload: ApprovalDecision, request: Request, user: CurrentUser):
    execution = await request.app.state.execution_coordinator.decide_approval(user.id, execution_id, approval_id, payload.decision)
    if execution is None:
        raise HTTPException(status_code=404, detail="Approbation introuvable ou déjà décidée différemment.")
    return execution


@router.post("/executions/{execution_id}/cancel", summary="Annuler une exécution")
async def cancel_execution(execution_id: str, request: Request, user: CurrentUser):
    execution = await request.app.state.execution_coordinator.cancel(user.id, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Exécution introuvable.")
    return execution


@router.get("/conversations", response_model=list[ConversationRead], summary="Lister les conversations")
async def list_conversations(database: Db, user: CurrentUser) -> list[ConversationRead]:
    return database.list_conversations(user.id)


@router.post(
    "/conversations",
    response_model=ConversationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Créer une conversation",
    dependencies=[Depends(rate_limit), TrustedOrigin],
)
async def create_conversation(payload: ConversationCreate, database: Db, user: CurrentUser) -> ConversationRead:
    return database.create_conversation(payload.title, user.id)


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    summary="Consulter une conversation",
)
async def get_conversation(conversation_id: str, database: Db, user: CurrentUser) -> ConversationRead:
    conversation = database.get_conversation(conversation_id, user.id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    return conversation


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    summary="Renommer une conversation",
    dependencies=[Depends(rate_limit), TrustedOrigin],
)
async def rename_conversation(conversation_id: str, payload: ConversationRename, database: Db, user: CurrentUser) -> ConversationRead:
    conversation = database.rename_conversation(conversation_id, payload.title, user.id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    return conversation


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer une conversation et ses messages",
    dependencies=[Depends(rate_limit), TrustedOrigin],
)
async def delete_conversation(conversation_id: str, database: Db, user: CurrentUser) -> Response:
    if not database.delete_conversation(conversation_id, user.id):
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageRead],
    summary="Récupérer les messages d’une conversation",
)
async def get_messages(conversation_id: str, database: Db, user: CurrentUser) -> list[MessageRead]:
    if database.get_conversation(conversation_id, user.id) is None:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    return database.list_messages(conversation_id)


@router.post(
    "/conversations/{conversation_id}/messages/stream",
    response_class=StreamingResponse,
    summary="Envoyer un message et recevoir la réponse en SSE",
    description=(
        "Le corps contient `content`. La réponse `text/event-stream` utilise les événements `user`, "
        "`delta`, `done` et `error`; chaque charge utile est JSON encodé sur une ligne `data:`. "
        "Les événements d’analyse privée ne sont jamais transmis."
    ),
    responses={
        200: {
            "description": "Flux SSE avec delta texte progressif et message final.",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        },
        404: {"description": "Conversation inconnue."},
        413: {"description": "Message trop long."},
        429: {"description": "Limite de requêtes atteinte."},
        503: {"description": "Clé OpenAI ou modèle non configuré."},
    },
    dependencies=[Depends(rate_limit), TrustedOrigin],
)
async def send_message_stream(
    conversation_id: str,
    payload: MessageCreate,
    request: Request,
    database: Db,
    settings: AppSettings,
    user: CurrentUser,
) -> StreamingResponse:
    if database.get_conversation(conversation_id, user.id) is None:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    selected_ids = database.get_conversation_connector_ids(user.id, conversation_id)
    if set(payload.connector_ids) != set(selected_ids) or len(payload.connector_ids) != len(selected_ids):
        raise HTTPException(status_code=409, detail="Les connecteurs sélectionnés ont changé. Rechargez la conversation.")
    mcp_ids = [connector_id for connector_id in payload.connector_ids if connector_id.startswith(MCP_CONNECTOR_PREFIX)]
    static_ids = [connector_id for connector_id in payload.connector_ids if not connector_id.startswith(MCP_CONNECTOR_PREFIX)]
    try:
        available_tools = request.app.state.tool_registry.tools_for_user(user.id, static_ids, database)
        request.app.state.mcp_runtime.validate_selection(user.id, mcp_ids)
    except ConnectorAuthorizationError as error:
        raise HTTPException(status_code=409, detail="Un connecteur sélectionné n’est pas autorisé.") from error
    except McpAuthorizationError as error:
        raise HTTPException(status_code=409, detail="Un serveur MCP sélectionné n’est pas autorisé.") from error
    if len(payload.content) > settings.max_message_chars:
        raise HTTPException(status_code=413, detail="Le message dépasse la limite autorisée.")
    if not settings.openai_configured:
        database.create_message(conversation_id, "user", payload.content.strip())
        raise HTTPException(status_code=503, detail="Le service IA n’est pas configuré sur le backend.")

    lock = request.app.state.conversation_locks[conversation_id]

    async def generate() -> AsyncIterator[str]:
        async with lock:
            if await request.is_disconnected():
                return
            user_message = database.create_message(conversation_id, "user", payload.content.strip())
            yield sse_event("user", user_message.model_dump(mode="json"))
            try:
                planning_request = PlanningRequest(
                    user_id=user.id, conversation_id=conversation_id,
                    message=payload.content.strip(), enabled_connector_ids=payload.connector_ids,
                )
                profiles = request.app.state.agent_service.list_profiles(user.id)
                connector_catalog = [*request.app.state.connector_registry.list()]
                connector_catalog.extend(mcp_connector_definition(row) for row in database.list_mcp_servers(user.id))
                decision = await request.app.state.request_router.route(
                    planning_request, profiles, connector_catalog
                )
                if decision.requires_orchestration:
                    execution = await request.app.state.execution_coordinator.start(user.id, conversation_id, decision)
                    yield sse_event("plan.ready", {"summary": decision.summary, "tasks": [task.model_dump(mode="json") for task in decision.tasks]})
                    yield sse_event("execution.created", execution.model_dump(mode="json"))
                    confirmation = f"J’ai démarré l’orchestration : {decision.summary}"
                    assistant_message = database.create_message(conversation_id, "assistant", confirmation, execution.id)
                    yield sse_event("done", {"message": assistant_message.model_dump(mode="json"), "execution": execution.model_dump(mode="json")})
                    return
            except PlanningUnavailable:
                yield sse_event("error", {"message": "La demande n’a pas pu être planifiée. Réessayez dans un instant."})
                return
            except PlanValidationError:
                logger.exception("Rejected invalid plan for conversation %s", conversation_id)
                yield sse_event("error", {"message": "Le plan proposé ne peut pas être exécuté en toute sécurité."})
                return
            except Exception:
                logger.exception("Planning request failed for conversation %s", conversation_id)
                yield sse_event("error", {"message": "La demande n’a pas pu être planifiée. Réessayez dans un instant."})
                return
            answer_parts: list[str] = []
            try:
                tool_context = ConnectorToolContext(
                    user.id, database, request.app.state.google_oauth, request.app.state.github_oauth
                ) if available_tools else None
                async with request.app.state.mcp_runtime.open_approved_servers(user.id, mcp_ids) as mcp_servers:
                    async for delta in stream_assistant(
                        conversation_id, payload.content.strip(), settings, available_tools, tool_context, mcp_servers,
                    ):
                        if await request.is_disconnected():
                            raise asyncio.CancelledError
                        answer_parts.append(delta)
                        yield sse_event("delta", {"delta": delta})
                answer = "".join(answer_parts).strip()
                if not answer:
                    raise RuntimeError("Agent completed without user-visible text output")
                assistant_message = database.create_message(conversation_id, "assistant", answer)
                yield sse_event("done", {"message": assistant_message.model_dump(mode="json")})
            except asyncio.CancelledError:
                logger.info("Client disconnected during assistant stream for conversation %s", conversation_id)
                raise
            except Exception:
                logger.exception("Assistant stream failed for conversation %s", conversation_id)
                yield sse_event("error", {"message": "Le message n’a pas pu être traité. Réessayez."})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


def connector_read(connector, database: Database, user_id: str, tool_registry: ToolRegistry) -> ConnectorRead:
    connection = database.get_connector_connection(user_id, connector.id)
    available_tools = tool_registry.descriptors_for_user(user_id, connector.id, database) if (
        connection and connection["status"] == "connected" and connector.availability == "available"
    ) else []
    return ConnectorRead(
        id=connector.id,
        name=connector.name,
        description=connector.description,
        icon=connector.icon,
        capabilities=list(connector.capabilities),
        available_tools=[tool.__dict__ for tool in available_tools],
        required_scopes=[permission.__dict__ for permission in connector.required_scopes],
        status=connection["status"] if connection else "disconnected",
        availability=connector.availability,
    )


def mcp_connector_definition(row: dict[str, object]) -> Connector:
    tools = json.loads(str(row["discovered_tools_json"]))
    approved = set(json.loads(str(row["approved_tools_json"])))
    approved_tools = tuple(
        ToolDescriptor(name=tool["name"], description=tool.get("description", ""), access=ToolAccess.READ)
        for tool in tools if tool.get("name") in approved and tool.get("access") == "read"
    )
    ready = row["status"] == "ready"
    status = "connected" if ready else "error" if row["status"] == "error" else "disconnected"
    return Connector(
        id=f"{MCP_CONNECTOR_PREFIX}{row['id']}", name=str(row["name"]),
        description=f"Serveur MCP distant · {row['url']}", icon="mcp",
        capabilities=tuple(tool.name for tool in approved_tools) or ("Aucun outil approuvé",),
        available_tools=approved_tools,
        required_scopes=tuple(ConnectorPermission(
            id=f"mcp.tool.{tool.name}", label=tool.name, description=tool.description,
            access=ToolAccess.READ,
        ) for tool in approved_tools),
        availability="available" if ready and approved_tools else "setup_required",
        auth_provider=UnavailableAuthProvider(),
    )


def mcp_connector_read(row: dict[str, object]) -> ConnectorRead:
    connector = mcp_connector_definition(row)
    approved = {tool.name for tool in connector.available_tools}
    return ConnectorRead(
        id=connector.id, name=connector.name, description=connector.description, icon=connector.icon,
        capabilities=list(connector.capabilities),
        available_tools=[{
            "name": tool.name, "description": tool.description, "access": tool.access.value,
            "required_scopes": [], "requires_human_approval": False,
        } for tool in connector.available_tools],
        required_scopes=[{
            "id": scope.id, "label": scope.label, "description": scope.description,
            "access": scope.access.value, "oauth_scope": None,
        } for scope in connector.required_scopes],
        status="connected" if row["status"] == "ready" else "error" if row["status"] == "error" else "disconnected",
        availability="available" if connector.availability == "available" else "setup_required",
    )


@router.get("/connectors", response_model=list[ConnectorRead], summary="Lister le catalogue des connecteurs")
async def list_connectors(request: Request, database: Db, user: CurrentUser) -> list[ConnectorRead]:
    catalog = [
        connector_read(connector, database, user.id, request.app.state.tool_registry)
        for connector in request.app.state.connector_registry.list()
    ]
    catalog.extend(mcp_connector_read(row) for row in database.list_mcp_servers(user.id))
    return catalog


@router.get("/connectors/mcp", response_model=list[McpServerRead], summary="Lister les serveurs MCP de l’utilisateur")
async def list_mcp_servers(database: Db, settings: AppSettings, user: CurrentUser) -> list[McpServerRead]:
    return McpService(database, settings).list_servers(user.id)


@router.post("/connectors/mcp/{server_id}/refresh", response_model=McpServerRead,
             dependencies=[Depends(rate_limit), TrustedOrigin], summary="Découvrir les outils d’un serveur MCP")
async def refresh_mcp_server(server_id: str, request: Request, user: CurrentUser) -> McpServerRead:
    try:
        return await request.app.state.mcp_runtime.refresh_tools(user.id, server_id)
    except HTTPException:
        raise
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail="Le serveur MCP n’a pas répondu à temps.") from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="Impossible d’inspecter ce serveur MCP.") from error


@router.post("/connectors/mcp", response_model=McpServerRead, status_code=201,
             dependencies=[Depends(rate_limit), TrustedOrigin], summary="Ajouter un serveur MCP distant")
async def create_mcp_server(payload: McpServerCreate, database: Db, settings: AppSettings, user: CurrentUser) -> McpServerRead:
    try:
        await asyncio.to_thread(validate_public_endpoint, payload.url)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Le serveur MCP doit utiliser une URL publique accessible.") from error
    return McpService(database, settings).create_server(user.id, payload)


@router.put("/connectors/mcp/{server_id}/tools", response_model=McpServerRead,
            dependencies=[Depends(rate_limit), TrustedOrigin], summary="Choisir les outils MCP autorisés")
async def update_mcp_server_tools(server_id: str, payload: McpServerUpdateTools, database: Db, settings: AppSettings, user: CurrentUser) -> McpServerRead:
    return McpService(database, settings).set_allowed_tools(user.id, server_id, payload.tool_names)


@router.delete("/connectors/mcp/{server_id}", status_code=204,
               dependencies=[Depends(rate_limit), TrustedOrigin], summary="Supprimer un serveur MCP")
async def delete_mcp_server(server_id: str, database: Db, settings: AppSettings, user: CurrentUser) -> Response:
    McpService(database, settings).delete_server(user.id, server_id)
    return Response(status_code=204)


@router.post("/connectors/{connector_id}/connect", dependencies=[Depends(rate_limit), TrustedOrigin], summary="Démarrer OAuth Google")
async def connect_google_connector(connector_id: str, request: Request, user: CurrentUser) -> dict[str, str]:
    if connector_id == "github":
        github_oauth: GitHubAppOAuthClient | None = request.app.state.github_oauth
        if github_oauth is None:
            raise HTTPException(status_code=503, detail="GitHub App OAuth n’est pas configuré sur le backend.")
        try:
            return {"authorization_url": github_oauth.authorization_url(user.id)}
        except GitHubOAuthNotConfigured as error:
            raise HTTPException(status_code=503, detail="GitHub App OAuth n’est pas configuré sur le backend.") from error
    scopes = GOOGLE_CONNECTOR_SCOPES.get(connector_id)
    if scopes is None:
        raise HTTPException(status_code=404, detail="Ce connecteur OAuth est inconnu.")
    oauth: GoogleOAuthClient | None = request.app.state.google_oauth
    if oauth is None:
        raise HTTPException(status_code=503, detail="Google OAuth n’est pas configuré sur le backend.")
    try:
        return {"authorization_url": oauth.authorization_url(user.id, sorted(scopes), connector_id=connector_id)}
    except GoogleOAuthNotConfigured as error:
        raise HTTPException(status_code=503, detail="Google OAuth n’est pas configuré sur le backend.") from error


@router.get("/connectors/google/callback", summary="Terminer OAuth Google")
@router.get("/connectors/google_calendar/callback", include_in_schema=False)
async def google_calendar_callback(request: Request, database: Db, settings: AppSettings) -> RedirectResponse:
    token = request.cookies.get(settings.auth_cookie_name)
    user = database.get_user_for_session(token_digest(token)) if token else None
    origin = settings.allowed_origins[0].rstrip("/")
    if user is None:
        return RedirectResponse(f"{origin}/connectors?oauth_error=session", status_code=303,
                                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    oauth: GoogleOAuthClient | None = request.app.state.google_oauth
    if oauth is None:
        return RedirectResponse(f"{origin}/connectors?oauth_error=unavailable", status_code=303,
                                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    if request.query_params.get("error"):
        return RedirectResponse(f"{origin}/connectors?oauth_error=denied", status_code=303,
                                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    try:
        result = await oauth.exchange_code(user.id, request.query_params.get("code", ""), request.query_params.get("state", ""))
    except InvalidOAuthState:
        return RedirectResponse(f"{origin}/connectors?oauth_error=state", status_code=303,
                                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    except Exception:
        logger.exception("Google OAuth callback failed for user %s", user.id)
        return RedirectResponse(f"{origin}/connectors?oauth_error=exchange", status_code=303,
                                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    return RedirectResponse(f"{origin}/connectors?connected={result['connector_id']}", status_code=303,
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@router.get("/connectors/github/callback", summary="Terminer OAuth GitHub")
async def github_callback(request: Request, database: Db, settings: AppSettings) -> RedirectResponse:
    token = request.cookies.get(settings.auth_cookie_name)
    user = database.get_user_for_session(token_digest(token)) if token else None
    origin = settings.allowed_origins[0].rstrip("/")
    headers = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
    if user is None:
        return RedirectResponse(f"{origin}/connectors?oauth_error=session", status_code=303, headers=headers)
    oauth: GitHubAppOAuthClient | None = request.app.state.github_oauth
    if oauth is None:
        return RedirectResponse(f"{origin}/connectors?oauth_error=unavailable", status_code=303, headers=headers)
    if request.query_params.get("error"):
        return RedirectResponse(f"{origin}/connectors?oauth_error=denied", status_code=303, headers=headers)
    try:
        await oauth.exchange_code(user.id, request.query_params.get("code", ""), request.query_params.get("state", ""))
    except Exception:
        logger.exception("GitHub OAuth callback failed for user %s", user.id)
        return RedirectResponse(f"{origin}/connectors?oauth_error=exchange", status_code=303, headers=headers)
    return RedirectResponse(f"{origin}/connectors?connected=github", status_code=303, headers=headers)


@router.post("/connectors/{connector_id}/disconnect", status_code=204,
             dependencies=[Depends(rate_limit), TrustedOrigin], summary="Déconnecter un connecteur Google")
async def disconnect_google_connector(connector_id: str, request: Request, user: CurrentUser) -> Response:
    if connector_id == "github":
        github_oauth: GitHubAppOAuthClient | None = request.app.state.github_oauth
        if github_oauth is None:
            raise HTTPException(status_code=503, detail="GitHub App OAuth n’est pas configuré sur le backend.")
        await github_oauth.revoke(user.id)
        return Response(status_code=204)
    if connector_id not in GOOGLE_CONNECTOR_SCOPES:
        raise HTTPException(status_code=404, detail="Ce connecteur OAuth est inconnu.")
    oauth: GoogleOAuthClient | None = request.app.state.google_oauth
    if oauth is None:
        raise HTTPException(status_code=503, detail="Google OAuth n’est pas configuré sur le backend.")
    await oauth.revoke(user.id, connector_id)
    return Response(status_code=204)


@router.get(
    "/conversations/{conversation_id}/connectors",
    response_model=ConnectorPreferencesRead,
    summary="Lire les connecteurs autorisés pour une conversation",
    responses={404: {"description": "Conversation inconnue pour cet utilisateur."}},
)
async def get_conversation_connectors(
    conversation_id: str, request: Request, database: Db, user: CurrentUser
) -> ConnectorPreferencesRead:
    if database.get_conversation(conversation_id, user.id) is None:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    connector_ids = database.get_conversation_connector_ids(user.id, conversation_id)
    connectors = []
    for connector_id in connector_ids:
        if connector_id.startswith(MCP_CONNECTOR_PREFIX):
            row = database.get_mcp_server(user.id, connector_id.removeprefix(MCP_CONNECTOR_PREFIX))
            if row:
                connectors.append(mcp_connector_read(row))
        else:
            connector = request.app.state.connector_registry.get(connector_id)
            if connector:
                connectors.append(connector_read(connector, database, user.id, request.app.state.tool_registry))
    return ConnectorPreferencesRead(
        conversation_id=conversation_id,
        connector_ids=connector_ids,
        connectors=connectors,
    )


@router.put(
    "/conversations/{conversation_id}/connectors",
    response_model=ConnectorPreferencesRead,
    summary="Enregistrer les connecteurs autorisés pour une conversation",
    responses={
        404: {"description": "Conversation inconnue pour cet utilisateur."},
        409: {"description": "Connecteur non connecté ou non disponible."},
    },
    dependencies=[Depends(rate_limit), TrustedOrigin],
)
async def set_conversation_connectors(
    conversation_id: str,
    payload: ConnectorPreferencesUpdate,
    request: Request,
    database: Db,
    user: CurrentUser,
) -> ConnectorPreferencesRead:
    if database.get_conversation(conversation_id, user.id) is None:
        raise HTTPException(status_code=404, detail="Conversation introuvable.")
    for connector_id in payload.connector_ids:
        if connector_id.startswith(MCP_CONNECTOR_PREFIX):
            try:
                request.app.state.mcp_runtime.validate_selection(user.id, [connector_id])
            except McpAuthorizationError as error:
                raise HTTPException(status_code=409, detail="Ce serveur MCP n’est pas disponible ou aucun outil de lecture n’est approuvé.") from error
            continue
        connector = request.app.state.connector_registry.get(connector_id)
        connection = database.get_connector_connection(user.id, connector_id)
        if connector is None or connector.availability != "available" or not connection or connection["status"] != "connected":
            raise HTTPException(status_code=409, detail="Ce connecteur n’est pas disponible ou connecté.")
    database.set_conversation_connector_ids(user.id, conversation_id, payload.connector_ids)
    connectors = []
    for connector_id in payload.connector_ids:
        if connector_id.startswith(MCP_CONNECTOR_PREFIX):
            row = database.get_mcp_server(user.id, connector_id.removeprefix(MCP_CONNECTOR_PREFIX))
            if row:
                connectors.append(mcp_connector_read(row))
        else:
            connector = request.app.state.connector_registry.get(connector_id)
            if connector:
                connectors.append(connector_read(connector, database, user.id, request.app.state.tool_registry))
    return ConnectorPreferencesRead(
        conversation_id=conversation_id,
        connector_ids=payload.connector_ids,
        connectors=connectors,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()
    database = Database(app_settings.database_path)
    configure_openai(app_settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        database.initialize()
        application.state.execution_repository.recover_interrupted()
        yield

    application = FastAPI(
        title="Mutual-AId API",
        description="API conversationnelle Mutual-AId avec réponse de l’agent Assistant en streaming SSE.",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.settings = app_settings
    application.state.database = database
    github_oauth: GitHubAppOAuthClient | None = None
    if app_settings.github_app_configured:
        try:
            github_oauth = GitHubAppOAuthClient(app_settings, database, TokenVault(app_settings.connector_token_key or ""), OAuthStateStore(database))
        except ValueError:
            logger.error("GitHub connector disabled because token encryption key is invalid")
    google_oauth: GoogleOAuthClient | None = None
    if app_settings.google_oauth_configured:
        try:
            vault = TokenVault(app_settings.connector_token_key or "")
            google_oauth = GoogleOAuthClient(app_settings, database, vault, OAuthStateStore(database))
        except ValueError:
            logger.error("Google connectors disabled because token encryption key is invalid")
    connector_registry = ConnectorRegistry(
        available_connector_ids=(set(GOOGLE_CONNECTOR_SCOPES) if google_oauth else set()) | ({"github"} if github_oauth else set()),
        setup_required_connector_ids=(set() if google_oauth else set(GOOGLE_CONNECTOR_SCOPES)) | (set() if github_oauth else {"github"}),
    )
    application.state.connector_registry = connector_registry
    application.state.tool_registry = ToolRegistry(connector_registry)
    application.state.mcp_runtime = McpRuntime(database, app_settings)
    application.state.google_oauth = google_oauth
    application.state.github_oauth = github_oauth
    if google_oauth:
        application.state.tool_registry.register(
            "gmail", "gmail_search_messages", gmail_search_messages,
            access="read", required_scopes=[GMAIL_READ_SCOPE],
            description="Rechercher des e-mails et renvoyer leur expéditeur, sujet, date et extrait.",
        )
        application.state.tool_registry.register(
            "google_drive", "drive_search_files", drive_search_files,
            access="read", required_scopes=[DRIVE_METADATA_READ_SCOPE],
            description="Rechercher des fichiers Drive et renvoyer leurs métadonnées sans lire leur contenu.",
        )
        application.state.tool_registry.register(
            "google_calendar", "calendar_list_events", calendar_list_events,
            access="read", required_scopes=[CALENDAR_READ_SCOPE],
            description="Lire les événements Google Calendar sur une période définie.",
        )
    if github_oauth:
        application.state.tool_registry.register(
            "github", "github_list_repositories", github_list_repositories,
            access="read", required_scopes=GITHUB_READ_PERMISSIONS,
            description="Lister les dépôts accessibles au compte GitHub connecté.",
        )
        application.state.tool_registry.register(
            "github", "github_list_issues", github_list_issues,
            access="read", required_scopes=GITHUB_READ_PERMISSIONS,
            description="Lire les issues d’un dépôt autorisé sur GitHub.",
        )
    profiles = AgentService(database)
    application.state.agent_service = profiles
    application.state.execution_repository = ExecutionRepository(database)
    application.state.execution_coordinator = ExecutionCoordinator(
        application.state.execution_repository, profiles, app_settings, database,
        application.state.tool_registry, google_oauth, github_oauth, application.state.mcp_runtime,
    )
    application.state.request_router = RequestRouter(Planner(app_settings), profiles)
    application.state.rate_limiter = RequestLimiter(app_settings.requests_per_minute)
    application.state.conversation_locks = defaultdict(asyncio.Lock)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
    )
    application.include_router(router)
    return application


app = create_app()
