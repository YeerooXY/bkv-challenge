import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("install_key", Path(__file__).parents[1] / "deploy/familyhub/install-key.py")
install_key = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install_key)


class EnvironmentKeyTests(unittest.TestCase):
    def test_systemd_quotes_special_characters(self):
        self.assertEqual(install_key.env_value('test"\\$#%key'), '"test\\"\\\\$#%key"')

    def test_rejects_empty_controls_spaces_unicode_and_oversize(self):
        for key in ("", "test\nkey", "test\rkey", "test\0key", "test key", "tést", "a" * 319):
            with self.subTest(key=repr(key)), self.assertRaises(ValueError):
                install_key.env_value(key)


if __name__ == "__main__":
    unittest.main()
