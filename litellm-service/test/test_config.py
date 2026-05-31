import unittest
import pathlib


class TestConfig(unittest.TestCase):
    def test_models_define_available_models(self):
        here = pathlib.Path(__file__).resolve()
        repo_root = here.parent.parent.parent
        cfg_path = repo_root / "config" / "easyai.yaml"
        self.assertTrue(cfg_path.exists())

        lines = cfg_path.read_text(encoding="utf-8").splitlines()
        models = set()
        section = None
        section_indent = 0

        for line in lines:
            if line.strip() == "models:":
                section = "models"
                section_indent = len(line) - len(line.lstrip(" "))
                continue
            if section and line.strip():
                indent = len(line) - len(line.lstrip(" "))
                if indent <= section_indent:
                    section = None
                    continue
                if section == "models" and indent == section_indent + 2 and line.rstrip().endswith(":"):
                    models.add(line.strip()[:-1])

        self.assertGreater(len(models), 0)


if __name__ == "__main__":
    unittest.main()
