import app.agent as agent_module
from app.config import Settings
from app.mcp_assistant import MCP_ASSISTANT_INSTRUCTIONS, install_mcp_assistant_instructions


def test_connected_mcp_servers_instruct_the_assistant_to_call_tools():
    install_mcp_assistant_instructions()
    settings = Settings(_env_file=None, openai_api_key="test-key", openai_model="test-model")

    assistant = agent_module.build_assistant(settings, mcp_servers=[object()])

    assert assistant.instructions == MCP_ASSISTANT_INSTRUCTIONS
    assert "call that" in assistant.instructions
    assert assistant.mcp_servers
