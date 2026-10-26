import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import types
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("foreground", Path(__file__).with_name("hermes-foreground.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ForegroundTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "PAPERCLIP_API_KEY": "test-only-secret", "PAPERCLIP_API_URL": "http://127.0.0.1:1/api",
            "PAPERCLIP_RUN_ID": "test-run", "HERMES_YOLO_MODE": "0",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_forward_result_and_limits_without_logging_credentials(self):
        seen = []
        def runner(args):
            seen.append(args)
            print("internal chatter")
            return "worker OK", {"completed": True, "session_id": "test-session"}
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = bridge.main(["chat", "-q", "test", "-Q", "--max-turns", "4", "--run-budget", "30"], runner)
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue(), "worker OK\n")
        self.assertNotIn("test-only-secret", out.getvalue() + err.getvalue())
        self.assertEqual((seen[0].max_turns, seen[0].run_budget), (4, 30))

    def test_missing_run_credentials_fail_before_model_execution(self):
        os.environ.pop("PAPERCLIP_API_KEY")
        called = []
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(bridge.main(["chat", "-q", "test"], lambda _: called.append(True)), 1)
        self.assertEqual(called, [])

    def test_cli_version_probe_needs_no_run_secret_or_model(self):
        os.environ.pop("PAPERCLIP_API_KEY")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as raised:
            bridge.main(["--version"])
        self.assertEqual(raised.exception.code, 0)
        self.assertIn("foreground bridge", out.getvalue())

    def test_arabic_result_uses_utf8_on_a_legacy_windows_stream(self):
        binary = io.BytesIO()
        legacy = io.TextIOWrapper(binary, encoding="cp1252")
        with contextlib.redirect_stdout(legacy):
            self.assertEqual(bridge.main(["chat", "-q", "test"],
                                        lambda _: ("تم الاتصال", {"completed": True})), 0)
        legacy.flush()
        self.assertEqual(binary.getvalue().decode("utf-8").splitlines(), ["تم الاتصال"])

    def test_partial_model_result_is_not_success(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bridge.main(["chat", "-q", "test"],
                                        lambda _: ("partial", {"completed": False})), 1)

    def test_approval_bypass_and_unsafe_resume_are_refused(self):
        for flag in ("--yolo", "--resume"):
            with self.subTest(flag=flag), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    bridge.parse_args(["chat", "-q", "test", flag])
        os.environ["HERMES_YOLO_MODE"] = "1"
        with self.assertRaises(RuntimeError):
            bridge.validate_environment()

    def test_provider_exception_details_do_not_leak(self):
        def runner(_):
            raise RuntimeError("test-only-secret")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(bridge.main(["chat", "-q", "test"], runner), 1)
        self.assertNotIn("test-only-secret", err.getvalue())

    def test_agent_class_contract_limits_and_approval_guards_are_preserved(self):
        module = types.ModuleType("run_agent")
        captured = {}
        class OriginalAgent:
            _TOOL_CALL_ARGUMENTS_CORRUPTION_MARKER = "original-marker"
            def __init__(self, **kwargs):
                captured.update(kwargs)
        module.AIAgent = OriginalAgent
        helper = types.ModuleType("hermes_cli.oneshot")
        def run(prompt, **kwargs):
            self.assertTrue(issubclass(module.AIAgent, OriginalAgent))
            self.assertEqual(module.AIAgent._TOOL_CALL_ARGUMENTS_CORRUPTION_MARKER, "original-marker")
            module.AIAgent(ephemeral_system_prompt="skill context")
            return "OK", {"completed": True}
        helper._run_agent = run
        with patch.dict(sys.modules, {"run_agent": module, "hermes_cli.oneshot": helper}), \
             patch.object(Path, "is_file", return_value=True), \
             patch.object(bridge, "validate_runtime"), \
             patch.dict(os.environ, {"LOCALAPPDATA": "test", "HERMES_EPHEMERAL_SYSTEM_PROMPT": "run context"}):
            bridge.foreground_turn(bridge.parse_args(["chat", "-q", "test", "--max-turns", "3", "--run-budget", "20"]))
            self.assertEqual(os.environ["HERMES_YOLO_MODE"], "0")
            self.assertNotIn("HERMES_ACCEPT_HOOKS", os.environ)
        self.assertIs(module.AIAgent, OriginalAgent)
        self.assertEqual(captured["max_iterations"], 3)
        self.assertEqual(captured["run_budget_seconds"], 20)
        self.assertEqual(captured["ephemeral_system_prompt"], "run context\n\nskill context")

    def test_changed_hermes_runtime_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = ("hermes_cli/oneshot.py", "run_agent.py", "tools/approval.py",
                     "tools/environments/local.py", "tools/environments/local_env_policy.py")
            hashes = {}
            for relative in paths:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"verified fixture")
                hashes[relative] = hashlib.sha256(target.read_bytes()).hexdigest()
            (root / "hermes-runtime.json").write_text(json.dumps({"hashes": hashes}), encoding="utf-8")
            with patch.object(bridge, "__file__", str(root / "bridge.py")):
                bridge.validate_runtime(root)
                (root / "run_agent.py").write_bytes(b"changed fixture")
                with self.assertRaises(RuntimeError):
                    bridge.validate_runtime(root)


if __name__ == "__main__":
    unittest.main()
