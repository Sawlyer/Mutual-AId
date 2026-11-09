from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.config import Settings
from app.connectors.mcp_catalog import McpCatalog, write_catalog
from app.connectors.mcp_runtime import McpRuntime
from app.main import create_app


def catalog_entry(entry_id: str, name: str, description: str) -> dict[str, object]:
    return {
        "id": entry_id, "name": name, "description": description, "category": "Finance",
        "source_url": f"https://mcpservers.org/fr/servers/{entry_id}", "badges": [],
        "endpoint": f"https://1.1.1.1/mcp/{entry_id}", "requires_token": False,
    }


def build_catalog(path):
    write_catalog(path, [
        catalog_entry("solana-public", "Solana Data Public", "État public du réseau Solana."),
        catalog_entry("solana-data", "47620 Solana Data", "Données onchain via x402 (USDC)."),
        catalog_entry("solana-forensics", "CabalLens Solana Forensics", "Analyse forensique Solana."),
        catalog_entry("dns-data", "DNS-DATA Remote MCP", "Données DNS et une mention solana dans la description."),
        catalog_entry("tokensafe", "TokenSafe by PromptVault", "Coffre de jetons."),
        catalog_entry("bilbop", "Bilbop x402", "Paiements."),
    ])
    return McpCatalog(path)


def test_a_server_name_wins_over_a_longer_adjective(tmp_path):
    path = tmp_path / "gamma.sqlite3"
    write_catalog(path, [
        catalog_entry("gamma", "Gamma", "Présentations à partir d’un prompt."),
        catalog_entry("studio", "Magnifique Studio", "Notes de travail."),
        catalog_entry("gammaflip", "GammaFlip", "Exposition gamma des options."),
    ])

    needed = McpCatalog(path).servers_needed("Je veux créer un magnifique diapo sur Gamma", set())

    assert [entry["id"] for entry in needed] == ["gamma"]


def test_only_a_server_named_in_the_request_is_required(tmp_path):
    catalog = build_catalog(tmp_path / "needed.sqlite3")

    needed = catalog.servers_needed("Je veux des informations sur le Solana Data", set())
    unrelated = catalog.servers_needed("Bonjour, comment ça va ?", set())

    assert [entry["id"] for entry in needed] == ["solana-public"]
    assert unrelated == []


def test_a_required_server_is_proposed_without_an_answer(tmp_path, monkeypatch):
    catalog_path = tmp_path / "proposal.sqlite3"
    build_catalog(catalog_path)
    settings = Settings(
        database_path=tmp_path / "proposal.sqlite3", openai_api_key="test-key", openai_model="test-model",
        mcp_catalog_path=catalog_path,
    )
    called = {"stream": 0, "route": 0}

    async def fake_route(*_args, **_kwargs):
        called["route"] += 1
        return SimpleNamespace(requires_orchestration=False, summary="", tasks=[])

    async def fake_stream(*_args, **_kwargs):
        called["stream"] += 1
        yield "Réponse de connaissance."

    monkeypatch.setattr("app.main.stream_assistant", fake_stream)
    with TestClient(create_app(settings)) as client:
        monkeypatch.setattr(client.app.state.request_router, "route", fake_route)
        client.post("/api/auth/register", json={"name": "Needed", "email": "needed@example.com", "password": "needed password long"})
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Je veux des informations sur le Solana Data"},
        )
        messages = client.get(f"/api/conversations/{conversation['id']}/messages").json()

    assert response.status_code == 200
    assert called == {"stream": 0, "route": 0}
    assert "event: mcp.suggestion" in response.text
    assert "solana-public" in response.text
    assert "solana-data" not in response.text
    assert "dns-data" not in response.text
    assert "tokensafe" not in response.text
    assert "bilbop" not in response.text
    assert "suggestions_only" in response.text
    assert "Réponse de connaissance." not in response.text
    assert "J’ai besoin du serveur MCP" not in response.text
    assert [message["role"] for message in messages] == ["user"]


def test_an_ordinary_question_proposes_nothing(tmp_path, monkeypatch):
    catalog_path = tmp_path / "ordinary.sqlite3"
    build_catalog(catalog_path)
    settings = Settings(
        database_path=tmp_path / "ordinary.sqlite3", openai_api_key="test-key", openai_model="test-model",
        mcp_catalog_path=catalog_path,
    )
    called = {"stream": 0}

    async def fake_route(*_args, **_kwargs):
        return SimpleNamespace(requires_orchestration=False, summary="", tasks=[])

    async def fake_stream(*_args, **_kwargs):
        called["stream"] += 1
        yield "Bonjour."

    monkeypatch.setattr("app.main.stream_assistant", fake_stream)
    with TestClient(create_app(settings)) as client:
        monkeypatch.setattr(client.app.state.request_router, "route", fake_route)
        client.post("/api/auth/register", json={"name": "Ordinary", "email": "ordinary@example.com", "password": "ordinary password long"})
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Bonjour, comment ça va ?"},
        )

    assert response.status_code == 200
    assert "event: mcp.suggestion" not in response.text
    assert called["stream"] == 1
    assert "Bonjour." in response.text


def test_an_enabled_matching_server_is_queried_instead_of_proposed(tmp_path, monkeypatch):
    catalog_path = tmp_path / "ready.sqlite3"
    build_catalog(catalog_path)
    settings = Settings(
        database_path=tmp_path / "ready.sqlite3", openai_api_key="test-key", openai_model="test-model",
        mcp_catalog_path=catalog_path,
    )
    called = {"servers": []}

    async def fake_stream(*_args, **_kwargs):
        yield "Cours lu."

    @asynccontextmanager
    async def fake_open(self, user_id, server_ids, *, conversation_id, agent_profile_id=None):
        called["servers"] = list(server_ids)
        yield [SimpleNamespace(name="solana")]

    monkeypatch.setattr("app.main.stream_assistant", fake_stream)
    monkeypatch.setattr(McpRuntime, "open_approved_servers", fake_open)
    with TestClient(create_app(settings)) as client:
        client.post("/api/auth/register", json={"name": "Ready", "email": "ready@example.com", "password": "ready password long enough"})
        user_id = client.app.state.database.get_user_by_email("ready@example.com")["id"]
        server_id = str(uuid4())
        client.app.state.database.create_mcp_server(server_id, user_id, "Solana Data Public", "https://1.1.1.1/mcp", None, "solana-public")
        client.app.state.database.update_mcp_server_tools(user_id, server_id, [{"name": "snapshot", "description": "Read", "access": "read"}])
        client.app.state.database.set_mcp_server_approved_tools(user_id, server_id, ["snapshot"])
        client.app.state.database.set_mcp_server_enabled(user_id, server_id, True)
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Je veux des informations sur le Solana Data", "connector_ids": []},
        )
        preferences = client.get(f"/api/conversations/{conversation['id']}/connectors").json()

    assert response.status_code == 200
    assert "event: mcp.suggestion" not in response.text
    assert "Cours lu." in response.text
    assert called["servers"] == [f"mcp:{server_id}"]
    assert preferences["connector_ids"] == [f"mcp:{server_id}"]


def _install_server(database, user_id: str, name: str, catalog_id: str) -> str:
    server_id = str(uuid4())
    database.create_mcp_server(server_id, user_id, name, "https://1.1.1.1/mcp", None, catalog_id)
    database.update_mcp_server_tools(user_id, server_id, [{"name": "snapshot", "description": "Read", "access": "read"}])
    database.set_mcp_server_approved_tools(user_id, server_id, ["snapshot"])
    database.set_mcp_server_enabled(user_id, server_id, True)
    return server_id


def test_freemium_fiches_and_paid_urls_are_refused(tmp_path):
    catalog_path = tmp_path / "strict.sqlite3"
    write_catalog(catalog_path, [
        catalog_entry("open-docs", "Docs libres", "Documentation publique."),
        catalog_entry("rug", "RugShield", "Un niveau gratuit est inclus."),
        catalog_entry("solana-data", "47620 Solana Data", "Données onchain via x402 (USDC)."),
    ])
    settings = Settings(
        database_path=tmp_path / "strict.sqlite3", openai_api_key="test-key", openai_model="test-model",
        mcp_catalog_path=catalog_path,
    )
    with TestClient(create_app(settings)) as client:
        client.post("/api/auth/register", json={"name": "Strict", "email": "strict@example.com", "password": "strict password long enough"})
        listed = client.get("/api/connectors/mcp/catalog", params={"q": "RugShield"})
        paid_url = client.post("/api/connectors/mcp", json={"name": "Solana", "url": "https://1.1.1.1/mcp/solana-data"})
        free_url = client.post("/api/connectors/mcp", json={"name": "Docs", "url": "https://1.1.1.1/mcp/open-docs"})

    assert listed.status_code == 200
    assert listed.json()["items"] == []
    assert paid_url.status_code == 422
    assert paid_url.json()["detail"] == "Ce serveur MCP n’est pas gratuit."
    assert free_url.status_code == 201


def test_a_paid_server_is_absent_from_the_catalog(tmp_path):
    catalog_path = tmp_path / "hidden.sqlite3"
    build_catalog(catalog_path)
    settings = Settings(
        database_path=tmp_path / "hidden.sqlite3", openai_api_key="test-key", openai_model="test-model",
        mcp_catalog_path=catalog_path,
    )
    with TestClient(create_app(settings)) as client:
        client.post("/api/auth/register", json={"name": "Hidden", "email": "hidden@example.com", "password": "hidden password long enough"})
        page = client.get("/api/connectors/mcp/catalog", params={"q": "Solana Data"})
        missing = client.get("/api/connectors/mcp/catalog/solana-data")
        created = client.post("/api/connectors/mcp", json={
            "name": "47620 Solana Data", "url": "https://1.1.1.1/mcp", "catalog_id": "solana-data",
        })

    assert page.status_code == 200
    identifiers = [item["id"] for item in page.json()["items"]]
    assert "solana-public" in identifiers
    assert "solana-data" not in identifiers
    assert missing.status_code == 404
    assert created.status_code == 404


def test_a_paid_server_is_not_called(tmp_path, monkeypatch):
    catalog_path = tmp_path / "paid.sqlite3"
    build_catalog(catalog_path)
    settings = Settings(
        database_path=tmp_path / "paid.sqlite3", openai_api_key="test-key", openai_model="test-model",
        mcp_catalog_path=catalog_path,
    )
    called = {"servers": None}

    async def fake_route(*_args, **_kwargs):
        return SimpleNamespace(requires_orchestration=False, summary="", tasks=[])

    async def fake_stream(*_args, **_kwargs):
        yield "Bonjour."

    @asynccontextmanager
    async def fake_open(self, user_id, server_ids, *, conversation_id, agent_profile_id=None):
        called["servers"] = list(server_ids)
        yield []

    monkeypatch.setattr("app.main.stream_assistant", fake_stream)
    monkeypatch.setattr(McpRuntime, "open_approved_servers", fake_open)
    with TestClient(create_app(settings)) as client:
        monkeypatch.setattr(client.app.state.request_router, "route", fake_route)
        client.post("/api/auth/register", json={"name": "Paid", "email": "paid@example.com", "password": "paid password long enough"})
        user_id = client.app.state.database.get_user_by_email("paid@example.com")["id"]
        server_id = _install_server(client.app.state.database, user_id, "47620 Solana Data", "solana-data")
        conversation = client.post("/api/conversations", json={}).json()
        connector_id = f"mcp:{server_id}"
        client.app.state.database.set_conversation_connector_ids(user_id, conversation["id"], [connector_id])
        hidden = client.get("/api/connectors/mcp")
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Bonjour, comment ça va ?", "connector_ids": [connector_id]},
        )

    assert hidden.status_code == 200
    assert hidden.json() == []
    assert response.status_code == 200
    assert "event: mcp.suggestion" not in response.text
    assert called["servers"] == []


def test_activation_resumes_the_original_request_without_a_new_prompt(tmp_path, monkeypatch):
    catalog_path = tmp_path / "resume.sqlite3"
    build_catalog(catalog_path)
    settings = Settings(
        database_path=tmp_path / "resume.sqlite3", openai_api_key="test-key", openai_model="test-model",
        mcp_catalog_path=catalog_path,
    )
    called = {"content": None, "servers": []}

    async def fake_route(*_args, **_kwargs):
        return SimpleNamespace(requires_orchestration=False, summary="", tasks=[])

    async def fake_stream(*args, **_kwargs):
        called["content"] = args[1]
        yield "Donnée lue."

    @asynccontextmanager
    async def fake_open(self, user_id, server_ids, *, conversation_id, agent_profile_id=None):
        called["servers"] = list(server_ids)
        yield [SimpleNamespace(name="solana")]

    monkeypatch.setattr("app.main.stream_assistant", fake_stream)
    monkeypatch.setattr(McpRuntime, "open_approved_servers", fake_open)
    question = "Je veux des informations sur le Solana Data"
    with TestClient(create_app(settings)) as client:
        monkeypatch.setattr(client.app.state.request_router, "route", fake_route)
        client.post("/api/auth/register", json={"name": "Resume", "email": "resume@example.com", "password": "resume password long enough"})
        user_id = client.app.state.database.get_user_by_email("resume@example.com")["id"]
        conversation = client.post("/api/conversations", json={}).json()
        proposal = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": question},
        )
        server_id = _install_server(client.app.state.database, user_id, "Solana Data Public", "solana-public")
        connector_id = f"mcp:{server_id}"
        client.put(
            f"/api/conversations/{conversation['id']}/connectors",
            json={"connector_ids": [connector_id]},
        )
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "", "connector_ids": [connector_id], "resume_with_tools": True},
        )
        messages = client.get(f"/api/conversations/{conversation['id']}/messages").json()

    assert proposal.status_code == 200
    assert "suggestions_only" in proposal.text
    assert response.status_code == 200
    assert called["content"] == question
    assert called["servers"] == [connector_id]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"] == question
    assert messages[1]["content"] == "Donnée lue."
    assert "J’ai activé le serveur MCP" not in response.text
