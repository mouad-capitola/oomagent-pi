# /// script
# requires-python = ">=3.13"
# dependencies = ["mcp==1.28.1"]
# ///
"""Minimale MCP-testserver voor Pi (stdio)."""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("OomAgent Test MCP")


@mcp.tool()
def hello(name: str) -> str:
    """Test of MCP werkt."""
    return f"Hallo {name}, je MCP server werkt! 🚀"


if __name__ == "__main__":
    mcp.run(transport="stdio")
