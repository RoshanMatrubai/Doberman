import argparse


def main():
    parser = argparse.ArgumentParser(
        description="GoldenRetriever — Scoped Access Broker for Agentic AI"
    )
    parser.add_argument("--mcp", action="store_true", help="Run as stdio MCP server")
    args = parser.parse_args()

    import config

    if args.mcp:
        print("GoldenRetriever MCP server starting (stdio)…", flush=True)
    else:
        print(
            f"GoldenRetriever — dashboard :{config.DASHBOARD_PORT}  "
            f"agent API :{config.AGENT_API_PORT}",
            flush=True,
        )


if __name__ == "__main__":
    main()
