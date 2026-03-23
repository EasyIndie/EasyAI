import os
import unittest
import importlib
import pathlib


class TestConfig(unittest.TestCase):
    def test_allowed_models_loaded(self):
        here = pathlib.Path(__file__).resolve()
        cfg = (here.parent.parent / "config" / "litellm.yaml").as_posix()
        os.environ["LITELLM_CONFIG_PATH"] = cfg
        m = importlib.import_module("app.main")
        self.assertTrue(isinstance(m._allowed_models(), list))


if __name__ == "__main__":
    unittest.main()
