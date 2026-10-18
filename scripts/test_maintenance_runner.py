import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('maintenance-runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_lock_evidence_and_failure_preserve_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root/'schema/维护'
            folder.mkdir(parents=True)
            plan = folder/'AI Box维护.json'
            plan.write_text(json.dumps({'version': 1, 'extra': 42, 'jobs': {'inbox': {}, 'weekly': {}}}), encoding='utf-8')
            args = ['--vault', str(root), '--kind', 'inbox']
            first = runner.run(['start', *args])
            with self.assertRaises(FileExistsError):
                runner.run(['start', '--vault', str(root), '--kind', 'weekly'])
            with self.assertRaises(ValueError):
                runner.run(['finish', *args, '--token', 'wrong', '--result', 'failed', '--error', 'blocked'])
            with self.assertRaises(ValueError):
                runner.run(['finish', *args, '--token', first['token'], '--result', 'success', '--evidence', 'missing.md'])
            (root/'report.md').write_text('Actual report', encoding='utf-8')
            runner.run(['finish', *args, '--token', first['token'], '--result', 'success', '--evidence', 'report.md'])
            success = json.loads(plan.read_text(encoding='utf-8'))['jobs']['inbox']['lastSuccess']
            second = runner.run(['start', *args])
            runner.run(['finish', *args, '--token', second['token'], '--result', 'failed', '--error', 'example failure'])
            final = json.loads(plan.read_text(encoding='utf-8'))
            self.assertEqual(final['jobs']['inbox']['lastSuccess'], success)
            self.assertEqual(final['extra'], 42)
            self.assertFalse((folder/'.ai-box-maintenance.lock').exists())


if __name__ == '__main__':
    unittest.main()
