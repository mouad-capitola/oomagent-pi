"""Credential resolver for Pi; stdout goes only to its MCP Authorization header."""
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    if os.environ.get("OOMAGENT_PI_ROOT"):
        value = (Path(os.environ["OOMAGENT_PI_ROOT"]) / ".portable/state/zap/mcp-key").read_text().strip()
    else:
        home = Path.home()
        config = home / ("Library/Application Support/ZAP/config.xml" if sys.platform == "darwin" else ".ZAP/config.xml")
        value = ET.parse(config).getroot().findtext("mcp/securityKey")
    if not value or "\n" in value or "\r" in value:
        raise ValueError()
    print(value, end="")
except Exception:
    print("ZAP MCP key unavailable; start the local ZAP service first.", file=sys.stderr)
    sys.exit(1)
