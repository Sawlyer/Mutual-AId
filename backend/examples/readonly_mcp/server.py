"""Development-only read-only MCP server.

It listens on 127.0.0.1:8765 and exposes a single health tool annotated as read-only.
Mutual-AId can reach that address only when MCP_ALLOW_LOOPBACK is explicitly true.
The default is false, including in Docker Compose, which does not start this process.
Private, link-local and cloud-metadata addresses stay refused even when loopback is allowed.
"""

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations


server = MCPServer("mutual-aid-dev")


@server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))
def health() -> str:
    """Report that the local development MCP server is running."""
    return "ok"


if __name__ == "__main__":
    server.run(transport="streamable-http", host="127.0.0.1", port=8765, streamable_http_path="/mcp")
