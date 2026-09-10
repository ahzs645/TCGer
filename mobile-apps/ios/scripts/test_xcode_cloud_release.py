"""Exercise the real Xcode Cloud hooks with an isolated, offline toolchain."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


CI_SCRIPTS = Path(__file__).resolve().parents[1] / "TCGer/ci_scripts"


class XcodeCloudReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Dereference the same resources Xcode Cloud copies into later phases.
        self.scripts = self.root / "ci_scripts"
        shutil.copytree(CI_SCRIPTS, self.scripts, symlinks=False)
        self.support = self.scripts / "app_store_release"
        (self.support / "project.pbxproj").write_text(
            "\tMARKETING_VERSION = 1.2.3;\n" * 4
        )
        self.notes = self.support / "fastlane/metadata/en-US/release_notes.txt"
        self.notes.write_text("Fix collection sync.\n")
        self.calls = self.root / "calls"
        mock_bin = self.root / "mock/bin"
        mock_bin.mkdir(parents=True)
        for name, content in {
            "brew": '#!/bin/bash\nif [[ "$1" == "--prefix" ]]; then echo "$MOCK_PREFIX"; fi\n',
            "bundle": '#!/bin/bash\nprintf "%s\\n" "$*" >> "$MOCK_CALLS"\nexit "${MOCK_BUNDLE_EXIT:-0}"\n',
        }.items():
            path = mock_bin / name
            path.write_text(content)
            path.chmod(0o755)
        self.env = {
            "PATH": f"{mock_bin}:/usr/bin:/bin",
            "TMPDIR": str(self.root),
            "MOCK_PREFIX": str(mock_bin.parent),
            "MOCK_CALLS": str(self.calls),
            "CI_XCODE_CLOUD": "TRUE",
            "CI_WORKFLOW": "Submit Release",
            "CI_XCODEBUILD_ACTION": "build",
            "CI_XCODEBUILD_EXIT_CODE": "0",
            "CI_PRODUCT_PLATFORM": "iOS",
            "CI_TAG": "ios-v1.2.3-b241",
            "CI_BUILD_NUMBER": "999",
            "APP_STORE_CONNECT_ISSUER_ID": "test-issuer",
            "APP_STORE_CONNECT_KEY_ID": "test-key-id",
            "APP_STORE_CONNECT_PRIVATE_KEY_BASE64": "test-secret-never-print",
        }

    def run_hook(self, name, **changes):
        env = self.env | changes
        result = subprocess.run(
            ["/bin/bash", str(self.scripts / name)],
            env=env, text=True, capture_output=True,
        )
        self.assertNotIn("test-secret-never-print", result.stdout + result.stderr)
        return result

    def test_success_submits_the_tagged_build_not_the_current_run(self):
        result = self.run_hook("ci_post_xcodebuild.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls.read_text().splitlines(), [
            "install --jobs 4 --retry 3",
            "exec fastlane ios submit_release version:1.2.3 build_number:241",
        ])
        self.assertFalse(list(self.root.glob("tcger-app-store.*")))

    def test_prebuild_validates_without_installing_or_submitting(self):
        result = self.run_hook("ci_pre_xcodebuild.sh", CI_XCODEBUILD_EXIT_CODE="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.calls.exists())

    def test_other_workflows_never_submit(self):
        for workflow in ("Release", "PR Fast Tests", ""):
            with self.subTest(workflow=workflow):
                result = self.run_hook("ci_post_xcodebuild.sh", CI_WORKFLOW=workflow)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.calls.exists())

    def test_invalid_release_context_stops_before_network_or_tools(self):
        for changes in (
            {"CI_TAG": ""},
            {"CI_TAG": "ios-v1.2.3-blatest"},
            {"CI_TAG": "ios-v1.2-b241"},
            {"CI_TAG": "ios-v9.9.9-b241"},
            {"CI_XCODE_CLOUD": ""},
            {"CI_XCODEBUILD_EXIT_CODE": "65"},
            {"CI_XCODEBUILD_EXIT_CODE": ""},
            {"CI_XCODEBUILD_ACTION": "archive"},
            {"CI_XCODEBUILD_ACTION": "test-without-building"},
            {"CI_PRODUCT_PLATFORM": "macOS"},
            {"CI_PULL_REQUEST_NUMBER": "42"},
            {"APP_STORE_CONNECT_PRIVATE_KEY_BASE64": ""},
            {"APP_STORE_CONNECT_ISSUER_ID": ""},
            {"APP_STORE_CONNECT_KEY_ID": ""},
        ):
            with self.subTest(changes=changes):
                result = self.run_hook("ci_post_xcodebuild.sh", **changes)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.calls.exists())

    def test_inconsistent_widget_version_is_rejected(self):
        with (self.support / "project.pbxproj").open("a") as project:
            project.write("MARKETING_VERSION = 1.2.4;\n")
        result = self.run_hook("ci_pre_xcodebuild.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_blank_release_notes_are_rejected(self):
        self.notes.write_text(" \n\t\n")
        result = self.run_hook("ci_pre_xcodebuild.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_dependency_failure_does_not_submit(self):
        result = self.run_hook("ci_post_xcodebuild.sh", MOCK_BUNDLE_EXIT="7")
        self.assertEqual(result.returncode, 7)
        self.assertEqual(self.calls.read_text(), "install --jobs 4 --retry 3\n")
        self.assertFalse(list(self.root.glob("tcger-app-store.*")))

    def test_normal_nonarchive_prebuild_still_skips_version_floor(self):
        result = self.run_hook("ci_pre_xcodebuild.sh", CI_WORKFLOW="PR Fast Tests")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Skipping", result.stdout)


if __name__ == "__main__":
    unittest.main()
