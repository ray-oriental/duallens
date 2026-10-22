"""Release privacy policy: synthetic strings only, no credentials or real files."""
from pathlib import Path
import subprocess
import tempfile
import unittest
import os
from unittest.mock import patch
from check_project import CheckError, check_privacy


# Synthetic examples are assembled so fixtures do not themselves contain private-looking metadata.
PRIVACY_TERMS = ('C:' + chr(92) + 'Users' + chr(92) + 'example-user', '/' + 'home' + '/example-user',
                 '192.' + '168.4.5', 'reader' + '@' + 'private.example', 'sk-' + 'x' * 32)

class PrivacyTests(unittest.TestCase):
    def test_each_policy_term_is_rejected_case_insensitively(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'README.md'
            for term in PRIVACY_TERMS:
                with self.subTest(term_index=PRIVACY_TERMS.index(term)):
                    source.write_text('public\n' + term.upper() + '\n', encoding='utf-8')
                    with self.assertRaisesRegex(CheckError, 'README.md:2'):
                        check_privacy(root)

    def test_vendor_exclusion_does_not_exempt_project_code_or_binary_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            vendor = root / 'extension/vendor/library'; vendor.mkdir(parents=True)
            (vendor / 'source.js').write_text(PRIVACY_TERMS[0])
            (root / 'README.md').write_text('https://example.org/\n')
            self.assertEqual(check_privacy(root), 1)
            source = root / 'extension/icon.png'
            source.write_bytes(b'\x89PNG\0' + PRIVACY_TERMS[0].encode())
            with self.assertRaisesRegex(CheckError, 'extension/icon.png:1'):
                check_privacy(root)

    def test_git_inventory_checks_tracked_and_new_files_and_ignores_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(['git', 'init', '-q', str(root)], check=True, capture_output=True)
            source = root / 'README.md'; source.write_text('public\n')
            subprocess.run(['git', '-C', str(root), 'add', 'README.md'], check=True, capture_output=True)
            source.write_text(PRIVACY_TERMS[0])
            with self.assertRaisesRegex(CheckError, 'README.md:1'): check_privacy(root)
            source.unlink()
            new = root / 'new.txt'; new.write_text(PRIVACY_TERMS[1], encoding='utf-8')
            with self.assertRaisesRegex(CheckError, 'new.txt:1'): check_privacy(root)
            new.write_text('public')
            self.assertEqual(check_privacy(root), 1)

    def test_optional_private_terms_are_local_and_missing_file_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'public'; root.mkdir(); (root/'README.md').write_text('synthetic-private-marker')
            terms=Path(tmp)/'terms.txt'
            with patch.dict(os.environ, {'DUALLENS_PRIVACY_TERMS_FILE':str(terms)}):
                self.assertEqual(check_privacy(root),1)
                terms.write_text('# local only\nsynthetic-private-marker\n')
                with self.assertRaisesRegex(CheckError,'README.md:1'):check_privacy(root)
                terms.write_text('different-marker')
                self.assertEqual(check_privacy(root),1)

    def test_noreply_author_email_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'README.md').write_text('author'+'@'+'users.noreply.github.com')
            self.assertEqual(check_privacy(root),1)

    def test_error_does_not_echo_sensitive_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private = 'private-marker-' + PRIVACY_TERMS[0]
            (root / 'README.md').write_text(private)
            with self.assertRaises(CheckError) as result: check_privacy(root)
            self.assertNotIn(private, str(result.exception))


if __name__ == '__main__':
    unittest.main()
