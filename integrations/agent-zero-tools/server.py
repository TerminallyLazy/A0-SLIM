"""Explicit stdio MCP entry point. No HTTP listener or automatic startup hook."""
import argparse
import asyncio
import contextlib
import json
import sys

import anyio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, CallToolResult

from .host import Host, VERSION, OPERATIONS


async def serve(host, stdout):
    server = Server("a0-slim-tools", version=VERSION)

    @server.list_tools()
    async def tools():
        descriptor = host.descriptor()
        result = []
        for name in OPERATIONS:
            properties = {"connection": {"type": "string", "enum": host.binding["connections"]}}
            if name.endswith("db_schema"):
                properties["target"] = {"type": "string", "maxLength": 200}
            result.append(Tool(name=name, description="Pinned DB Hub " + OPERATIONS[name] + "; status/schema only, no agent task or database mutation.",
                               inputSchema={"type": "object", "properties": properties, "required": ["connection"], "additionalProperties": False,
                                            "x-a0-slim-companion": descriptor}))
        return result

    @server.call_tool()
    async def call(name, arguments):
        try:
            meta = server.request_context.meta
            values = meta.model_dump() if meta else {}
            operation = values.get("io.a0-slim/operation", {})
            result = await host.call(name, arguments, operation)
            return [TextContent(type="text", text=json.dumps(result))]
        except Exception:
            # Framework/provider exception text may contain secrets. Details stay in the receipt.
            return CallToolResult(isError=True, content=[TextContent(type="text", text="Companion rejected the operation or its outcome is unknown. Inspect the host receipt and rediscover before continuing.")])

    async with stdio_server(stdout=stdout) as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binding", required=True)
    parser.add_argument("--inspect")
    parser.add_argument("--resolve")
    parser.add_argument("--reason")
    args = parser.parse_args()
    output = sys.stdout
    # Agent Zero prints tool logs. Preserve stdout exclusively for MCP framing.
    with contextlib.redirect_stdout(sys.stderr):
        host = Host(args.binding, inspect_only=bool(args.inspect or args.resolve))
        if args.resolve:
            host.journal.resolve(args.resolve, args.reason or "")
        if args.inspect or args.resolve:
            output.write(json.dumps(host.journal.inspect(args.inspect or args.resolve)) + "\n")
        else:
            asyncio.run(serve(host, anyio.wrap_file(output)))


if __name__ == "__main__":
    main()
