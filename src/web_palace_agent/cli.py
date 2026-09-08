from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .config import load_project_config
from .orchestrator import Orchestrator
from .providers import LangChainAgentProvider


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Web Palace agentic workflow")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Start a new checkpointed workflow")
    run.add_argument("project", type=Path)
    resume = commands.add_parser("resume", help="Resume a workflow waiting for build approval")
    resume.add_argument("project", type=Path)
    resume.add_argument("run_id")
    resume.add_argument("decision", choices=["approve", "revise", "reject"])
    resume.add_argument("--feedback", default="")
    return parser


async def _run(args: argparse.Namespace) -> int:
    root = Path(__file__).resolve().parents[2]
    config = load_project_config(args.project)
    provider = LangChainAgentProvider(root / "prompts")
    orchestrator = Orchestrator(
        config,
        provider,
        root / "runs",
        run_id=args.run_id if args.command == "resume" else None,
    )
    state = (
        await orchestrator.resume(args.decision, args.feedback)
        if args.command == "resume"
        else await orchestrator.run()
    )
    print(json.dumps(state.model_dump(mode="json"), indent=2))
    print(f"\nRun evidence: {root / 'runs' / state.run_id}")
    if state.status == "APPROVAL_REQUIRED":
        print(
            "Resume after inspecting the saved builder output:\n"
            f"  web-palace-agent resume {args.project} {state.run_id} approve"
        )
    return 0 if state.status in {"ACCEPTED", "ACCEPTED_WITH_NOTES", "APPROVAL_REQUIRED"} else 1


def main() -> None:
    args = build_parser().parse_args()
    raise SystemExit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
