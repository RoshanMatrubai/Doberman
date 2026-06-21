import sys
import argparse


def main():
    parser = argparse.ArgumentParser(description="GoldenRetriever — AI Agent Authenticator")
    parser.add_argument("--mcp", action="store_true", help="Run as stdio MCP server")
    args = parser.parse_args()

    if args.mcp:
        print("GoldenRetriever MCP server starting (stdio)…", flush=True)
        from agent.mcp_server import run_mcp
        run_mcp()
    else:
        import config
        print(
            f"GoldenRetriever starting — "
            f"dashboard :{ config.DASHBOARD_PORT }  agent API :{config.AGENT_API_PORT}",
            flush=True,
        )
        from dashboard.app import create_app
        from agent.api import agent_bp
        import threading

        app, socketio = create_app()
        app.register_blueprint(agent_bp)

        def run_agent_api():
            from agent.api import create_agent_app
            agent_app, agent_socketio = create_agent_app()
            agent_socketio.run(agent_app, host="127.0.0.1", port=config.AGENT_API_PORT, use_reloader=False)

        t = threading.Thread(target=run_agent_api, daemon=True)
        t.start()

        socketio.run(app, host="127.0.0.1", port=config.DASHBOARD_PORT, use_reloader=False)


if __name__ == "__main__":
    main()
