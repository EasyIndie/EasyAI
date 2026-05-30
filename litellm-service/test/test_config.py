import unittest
import pathlib


class TestConfig(unittest.TestCase):
    def test_model_aliases_define_available_models(self):
        here = pathlib.Path(__file__).resolve()
        repo_root = here.parent.parent.parent
        cfg_path = repo_root / "config" / "litellm" / "litellm.yaml"
        self.assertTrue(cfg_path.exists())

        lines = cfg_path.read_text(encoding="utf-8").splitlines()
        aliases = set()
        allowed = []
        section = None
        section_indent = 0

        for line in lines:
            if line.strip() == "model_aliases:":
                section = "model_aliases"
                section_indent = len(line) - len(line.lstrip(" "))
                continue
            if line.strip() == "allowed_models:":
                section = "allowed_models"
                section_indent = len(line) - len(line.lstrip(" "))
                continue
            if section and line.strip():
                indent = len(line) - len(line.lstrip(" "))
                if indent <= section_indent:
                    section = None
                    continue
                if section == "model_aliases" and indent == section_indent + 2 and line.rstrip().endswith(":"):
                    aliases.add(line.strip()[:-1])
                if section == "allowed_models" and line.strip().startswith("- "):
                    allowed.append(line.strip()[2:].strip())

        self.assertGreater(len(aliases), 0)
        for model in allowed:
            self.assertIn(model, aliases)


if __name__ == "__main__":
    unittest.main()
