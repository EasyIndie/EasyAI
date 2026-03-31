import os
import unittest
import pathlib


class TestConfig(unittest.TestCase):
    def test_allowed_models_loaded(self):
        here = pathlib.Path(__file__).resolve()
        repo_root = here.parent.parent.parent
        cfg_path = repo_root / "config" / "litellm" / "litellm.yaml"
        self.assertTrue(cfg_path.exists())
        os.environ["LITELLM_CONFIG_PATH"] = cfg_path.as_posix()

        text = cfg_path.read_text(encoding="utf-8")
        lines = text.splitlines()

        allowed = []
        in_allowed = False
        allowed_indent = None
        for line in lines:
            if line.strip() == "allowed_models:":
                in_allowed = True
                allowed_indent = len(line) - len(line.lstrip(" "))
                continue
            if in_allowed:
                if not line.strip():
                    continue
                indent = len(line) - len(line.lstrip(" "))
                if indent <= allowed_indent:
                    in_allowed = False
                    continue
                s = line.strip()
                if s.startswith("- "):
                    allowed.append(s[2:].strip())

        self.assertTrue(isinstance(allowed, list))
        self.assertGreater(len(allowed), 0)

        aliases = set()
        in_aliases = False
        aliases_indent = None
        for line in lines:
            if line.strip() == "model_aliases:":
                in_aliases = True
                aliases_indent = len(line) - len(line.lstrip(" "))
                continue
            if in_aliases:
                if not line.strip():
                    continue
                indent = len(line) - len(line.lstrip(" "))
                if indent <= aliases_indent:
                    in_aliases = False
                    continue
                if indent == aliases_indent + 2 and line.rstrip().endswith(":"):
                    aliases.add(line.strip()[:-1])

        for m in allowed:
            self.assertIn(m, aliases)


if __name__ == "__main__":
    unittest.main()
