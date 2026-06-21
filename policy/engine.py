"""
Task-to-scope policy engine.

Given a service name and a natural-language task, derives the minimum
permission allow-list the agent needs.  Conservative default: deny anything
not clearly signalled by the task text.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Action catalogs
#
# Structure: service → action → (trigger_phrases, is_destructive)
#
# is_destructive=False  — read/browse actions; granted on any trigger match
# is_destructive=True   — write/mutate actions; triggers are explicit
#                         intent verbs so the bar is naturally higher
# ---------------------------------------------------------------------------
_CATALOGS: dict[str, dict[str, tuple[list[str], bool]]] = {
    # All services use only the five canonical actions:
    # search, read, write, purchase, delete
    "amazon": {
        "search":   (["search", "find", "look", "compare", "price", "browse",
                      "check", "cheapest", "list", "discover"], False),
        "read":     (["read", "view", "detail", "info", "see", "result",
                      "rating", "review", "describe", "description", "page",
                      "product", "item", "laptop", "price", "compare"], False),
        "write":    (["create listing", "update listing", "add listing",
                      "edit listing", "write review", "post review",
                      "submit review", "leave review", "rate product"], True),
        "purchase": (["buy", "purchase", "order", "checkout", "add to cart",
                      "cart", "pay", "payment", "place order", "acquire",
                      "transaction"], True),
        "delete":   (["delete", "cancel", "remove", "return item",
                      "refund", "archive"], True),
    },
    "google": {
        "search":   (["search", "find", "look", "query", "google",
                      "research", "discover", "browse"], False),
        "read":     (["read", "view", "open", "see", "check", "get",
                      "access", "retrieve", "email", "inbox", "calendar",
                      "schedule", "meeting", "drive", "file", "document",
                      "doc", "sheet", "agenda", "event", "appointment",
                      "paper", "article", "result", "research"], False),
        "write":    (["send email", "reply", "compose", "draft email",
                      "create event", "schedule meeting", "book meeting",
                      "add to calendar", "create file", "upload",
                      "edit file", "save to drive", "new document",
                      "write doc"], True),
        "purchase": (["buy", "purchase", "pay", "subscribe",
                      "checkout", "billing"], True),
        "delete":   (["delete", "remove", "archive", "cancel",
                      "unsubscribe", "trash"], True),
    },
    "github": {
        "search":   (["search", "find", "look", "query", "discover",
                      "browse", "explore", "list"], False),
        "read":     (["read", "view", "check", "see", "repo", "repository",
                      "code", "file", "commit", "branch", "source",
                      "issue", "bug", "ticket", "pr", "pull request",
                      "diff", "release", "version", "changelog"], False),
        "write":    (["create issue", "open issue", "file bug", "report bug",
                      "new issue", "create pr", "open pr", "submit pr",
                      "merge pr", "push", "commit", "edit code",
                      "update code", "add comment", "add file"], True),
        "purchase": (["sponsor", "pay", "billing", "subscribe"], True),
        "delete":   (["delete", "remove", "close issue", "close pr",
                      "archive", "drop branch", "cancel"], True),
    },
    "slack": {
        "search":   (["search", "find", "look", "query", "browse",
                      "discover", "list channels"], False),
        "read":     (["read", "view", "check", "see", "channel", "message",
                      "chat", "conversation", "thread", "dm", "inbox",
                      "notification", "mention", "summarize", "summary",
                      "recent", "slack"], False),
        "write":    (["send message", "post message", "post to", "reply to",
                      "respond to", "direct message", "dm to",
                      "notify", "alert", "ping", "write to",
                      "create channel", "new channel"], True),
        "purchase": (["subscribe", "upgrade", "pay", "billing"], True),
        "delete":   (["delete message", "remove message",
                      "archive channel", "kick user", "remove user"], True),
    },
    "jira": {
        "search":   (["search", "find", "look", "query", "browse",
                      "discover", "filter", "list"], False),
        "read":     (["read", "view", "check", "see", "issue", "ticket",
                      "task", "story", "bug", "sprint", "board", "backlog",
                      "summary", "report", "open", "high priority"], False),
        "write":    (["create issue", "new ticket", "file bug", "update issue",
                      "assign ticket", "resolve", "close ticket", "edit issue",
                      "add comment", "transition issue", "log work"], True),
        "purchase": (["subscribe", "upgrade", "billing", "pay"], True),
        "delete":   (["delete issue", "remove ticket", "archive",
                      "bulk delete", "purge"], True),
    },
}

# Read prerequisites auto-added when a destructive action is granted.
# Ensures an agent that can purchase can also search/read (coherent scope).
_PREREQUISITES: dict[str, list[str]] = {
    "purchase": ["search", "read"],
    "write":    ["read"],
    "delete":   ["read"],
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def derive_scope(service: str, task: str) -> list[str]:
    """
    Derive the minimum permission allow-list for a service + task.
    Returns [] for unknown services or tasks that match no actions.
    """
    catalog = _CATALOGS.get(service.lower())
    if not catalog:
        return []

    task_lower = task.lower()
    granted: set[str] = set()

    for action, (triggers, _is_destructive) in catalog.items():
        if _any_trigger_matches(task_lower, triggers):
            granted.add(action)

    # Add coherence prerequisites for any destructive action that was granted
    for action in list(granted):
        for prereq in _PREREQUISITES.get(action, []):
            if prereq in catalog:
                granted.add(prereq)

    return sorted(granted)


def list_service_actions(service: str) -> list[str]:
    """All possible actions for a service (shown in UI / MCP tool description)."""
    return sorted(_CATALOGS.get(service.lower(), {}).keys())


def list_supported_services() -> list[str]:
    """Services with known action catalogs."""
    return sorted(_CATALOGS.keys())


def is_action_in_scope(action: str, scope: list[str]) -> bool:
    """Check whether a requested action is permitted by the issued scope."""
    return action in scope


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _any_trigger_matches(task: str, triggers: list[str]) -> bool:
    return any(_phrase_in_text(phrase, task) for phrase in triggers)


def _phrase_in_text(phrase: str, text: str) -> bool:
    """
    Word-boundary-aware search.
    - Single words: left-boundary only, so 'meeting' matches 'meetings' and
      'buy' doesn't match 'subway'.
    - Multi-word phrases: full boundaries on both ends so 'open issue'
      doesn't match 'open issues'.
    """
    if " " in phrase:
        return bool(re.search(r"\b" + re.escape(phrase) + r"\b", text))
    # Left-boundary only handles plurals/verb-forms
    return bool(re.search(r"\b" + re.escape(phrase), text))
