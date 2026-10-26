"""Run a Paperclip Hermes turn in its own process, with run-scoped credentials.

Hermes' shared gateway does not transport secret client environment variables.
Use its foreground agent primitive without the oneshot entrypoint, which forces
approval bypass. Never copy run credentials into a shared config or prompt.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sys


def parse_args(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", action="version", version="Paperclip Hermes foreground bridge 1")
    parser.add_argument("command", choices=["chat"])
    parser.add_argument("-q", "--query", required=True)
    parser.add_argument("-Q", "--quiet", action="store_true")
    parser.add_argument("-m", "--model")
    parser.add_argument("--provider")
    parser.add_argument("-t", "--toolsets")
    parser.add_argument("--source", choices=["tool"], default="tool")
    parser.add_argument("--max-turns", type=int, default=5)
    parser.add_argument("--run-budget", type=float, default=115)
    parser.add_argument("--reasoning", default="low")
    args = parser.parse_args(argv)
    if args.max_turns <= 0 or args.run_budget <= 0:
        parser.error("Turn and time limits must be positive")
    return args


def validate_environment():
    names = ("PAPERCLIP_API_KEY", "PAPERCLIP_API_URL", "PAPERCLIP_RUN_ID")
    if any(not os.environ.get(name) for name in names):
        raise RuntimeError("Paperclip run environment is incomplete")
    if os.environ.get("HERMES_YOLO_MODE") not in (None, "", "0"):
        raise RuntimeError("Foreground bridge requires command approvals")


def validate_runtime(home):
    manifest = json.loads(Path(__file__).with_name("hermes-runtime.json").read_text(encoding="utf-8-sig"))
    hashes = manifest.get("hashes", {})
    required = ("hermes_cli/oneshot.py", "run_agent.py", "tools/approval.py",
                "tools/environments/local.py", "tools/environments/local_env_policy.py")
    if set(hashes) != set(required):
        raise RuntimeError("Hermes runtime verification is incomplete")
    for relative in required:
        if hashlib.sha256((home / relative).read_bytes()).hexdigest() != hashes[relative]:
            raise RuntimeError("Hermes runtime changed; review and reinstall the bridge")


def foreground_turn(args):
    home = Path(os.environ["LOCALAPPDATA"]) / "hermes" / "hermes-agent"
    if not (home / "hermes_cli" / "oneshot.py").is_file():
        raise RuntimeError("Compatible Hermes Python runtime is unavailable")
    validate_runtime(home)
    sys.path.insert(0, str(home))
    os.environ["HERMES_SINGLE_QUERY_SESSION"] = "1"
    os.environ["HERMES_SESSION_SOURCE"] = "tool"
    os.environ["HERMES_SESSION_SOURCE_EXPLICIT"] = "1"
    # Explicitly retain approval gates. Do not call run_oneshot(), which sets
    # HERMES_YOLO_MODE and HERMES_ACCEPT_HOOKS unconditionally.
    os.environ["HERMES_YOLO_MODE"] = "0"
    os.environ.pop("HERMES_ACCEPT_HOOKS", None)
    import run_agent
    from hermes_cli.oneshot import _run_agent

    original_agent = run_agent.AIAgent

    class BoundedAgent(original_agent):
        def __init__(self, **kwargs):
            kwargs["max_iterations"] = args.max_turns
            kwargs["run_budget_seconds"] = args.run_budget
            prompt = os.environ.get("HERMES_EPHEMERAL_SYSTEM_PROMPT", "")
            if prompt:
                kwargs["ephemeral_system_prompt"] = "\n\n".join(
                    part for part in (prompt, kwargs.get("ephemeral_system_prompt")) if part
                )
            super().__init__(**kwargs)

    run_agent.AIAgent = BoundedAgent
    try:
        return _run_agent(args.query, model=args.model, provider=args.provider,
                          toolsets=args.toolsets, reasoning=args.reasoning)
    finally:
        run_agent.AIAgent = original_agent


def main(argv=None, runner=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        validate_environment()
        # Keep diagnostic/model chatter away from the adapter's parsed result.
        # The scoped credential is never formatted into an argument or log.
        with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink):
            response, result = (runner or foreground_turn)(args)
        if response:
            print(response)
        session = result.get("session_id")
        if session:
            print("session_id: " + str(session), file=sys.stderr)
        return 0 if result.get("completed") is True and not result.get("interrupted") else 1
    except Exception as error:
        # Exception text from a provider can contain credentials. Report only
        # the error class and keep the task visibly failed.
        print("Hermes foreground run failed (" + type(error).__name__ + ")", file=sys.stderr)
        import traceback
        for frame in traceback.extract_tb(error.__traceback__):
            print(Path(frame.filename).name + ":" + str(frame.lineno) + " in " + frame.name, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
