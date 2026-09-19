"""Offline tests only. No API call or DNS mutation is performed."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('hook', Path(__file__).with_name('certbot-dnspod.py'))
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
VALUE = 'A' * 43


class HooksTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / 'state'
        patcher = patch.object(hook, 'STATE_DIR', self.state)
        patcher.start()
        self.addCleanup(patcher.stop)

    def record(self, **changes):
        return {'RecordInfo': {'Id': 123, 'SubDomain': hook.LABEL, 'RecordType': 'TXT', 'Value': VALUE, **changes}}

    def test_only_exact_domain_and_dns01_validation(self):
        self.assertEqual(hook.challenge({'CERTBOT_DOMAIN': hook.DOMAIN, 'CERTBOT_VALIDATION': VALUE}), VALUE)
        for domain in ('aiducation.asia', '*.mandarin.aiducation.asia', 'MANDARIN.AIDUCATION.ASIA', 'other.example'):
            with self.assertRaises(hook.HookError):
                hook.challenge({'CERTBOT_DOMAIN': domain, 'CERTBOT_VALIDATION': VALUE})
        for value in ('', 'A' * 42, 'A' * 44, 'A' * 42 + ';'):
            with self.assertRaises(hook.HookError):
                hook.challenge({'CERTBOT_DOMAIN': hook.DOMAIN, 'CERTBOT_VALIDATION': value})

    def test_api_refuses_out_of_scope_dns_edits_before_transport(self):
        api = hook.DNSPod('test-id', 'test-secret')
        with patch.object(hook.requests, 'post') as post:
            for action, payload in [('ModifyRecord', {}), ('DeleteRecord', {'Domain': 'other.example', 'RecordId': 1}), ('CreateRecord', {'Domain': hook.ZONE, 'SubDomain': '@', 'RecordType': 'A', 'Value': '127.0.0.1'})]:
                with self.assertRaises(hook.HookError):
                    api.call(action, payload)
            post.assert_not_called()

    def test_credentials_read_only_selected_dotenv_values_without_shell_evaluation(self):
        env_file = Path(self.temp.name) / 'app.env'
        env_file.write_text('TENCENT_SECRET_ID=\'test-id\'\nTENCENT_SECRET_KEY="test-secret"\nOTHER=$(must-never-execute)\n', encoding='utf-8')
        env_file.chmod(0o600)
        with patch.object(hook, 'ENV_FILE', env_file):
            self.assertEqual(hook.credentials(), ('test-id', 'test-secret'))

    def test_auth_creates_one_scoped_record_and_outputs_opaque_run(self):
        api = Mock()
        api.call.return_value = {'RecordId': 123}
        output = io.StringIO()
        with patch.object(hook, 'wait_for_propagation') as wait, contextlib.redirect_stdout(output):
            hook.authenticate(api, VALUE)
        run = output.getvalue().strip()
        self.assertRegex(run, r'^[a-f0-9]{32}$')
        wait.assert_called_once_with(VALUE)
        api.call.assert_called_once_with('CreateRecord', {'Domain': hook.ZONE, 'SubDomain': hook.LABEL, 'RecordType': 'TXT', 'RecordLine': '默认', 'Value': VALUE, 'TTL': 600})
        state = json.loads((self.state / (run + '.json')).read_text())
        self.assertEqual(state['record_id'], 123)
        self.assertEqual(state['validation_hash'], hook.validation_hash(VALUE))
        self.assertNotIn(VALUE, json.dumps(state))

    def test_cleanup_only_deletes_matching_created_record_and_is_idempotent(self):
        run = hook.create_state(123, VALUE)
        api = Mock()
        api.call.side_effect = [self.record(), {}]
        hook.cleanup(api, VALUE, run)
        self.assertEqual(api.call.call_args_list[1].args, ('DeleteRecord', {'Domain': hook.ZONE, 'RecordId': 123}))
        self.assertFalse((self.state / (run + '.json')).exists())
        api.reset_mock()
        hook.cleanup(api, VALUE, run)
        api.call.assert_not_called()

    def test_cleanup_refuses_other_run_validation_or_changed_record(self):
        run = hook.create_state(123, VALUE)
        api = Mock()
        with self.assertRaises(hook.HookError):
            hook.cleanup(api, 'B' * 43, run)
        api.call.assert_not_called()
        for changes in ({'SubDomain': '@'}, {'RecordType': 'A'}, {'Value': 'B' * 43}, {'Id': 456}):
            api.call.return_value = self.record(**changes)
            with self.assertRaises(hook.HookError):
                hook.cleanup(api, VALUE, run)
            self.assertTrue((self.state / (run + '.json')).exists())
        self.assertTrue(all(call.args[0] == 'DescribeRecord' for call in api.call.call_args_list))
        with self.assertRaises(hook.HookError):
            hook.cleanup(api, VALUE, '../wrong')

    def test_cleanup_does_not_accept_record_list_schema(self):
        run = hook.create_state(123, VALUE)
        api = Mock()
        api.call.return_value = {'RecordInfo': {'RecordId': 123, 'Name': hook.LABEL, 'Type': 'TXT', 'Value': VALUE}}
        with self.assertRaises(hook.HookError):
            hook.cleanup(api, VALUE, run)
        api.call.assert_called_once_with('DescribeRecord', {'Domain': hook.ZONE, 'RecordId': 123})
        self.assertTrue((self.state / (run + '.json')).exists())

    def test_failed_propagation_rolls_back_only_its_own_record(self):
        api = Mock()
        api.call.side_effect = [{'RecordId': 123}, self.record(), {}]
        with patch.object(hook, 'wait_for_propagation', side_effect=hook.HookError('DNSPropagationTimeout')), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(hook.HookError):
                hook.authenticate(api, VALUE)
        self.assertEqual([call.args[0] for call in api.call.call_args_list], ['CreateRecord', 'DescribeRecord', 'DeleteRecord'])
        self.assertEqual(list(self.state.glob('*.json')), [])

    def test_provider_errors_expose_code_not_message_or_credentials(self):
        api = hook.DNSPod('test-id', 'test-secret')
        response = Mock(status_code=200)
        response.json.return_value = {'Response': {'Error': {'Code': 'AuthFailure.SignatureFailure', 'Message': 'private credentials'}}}
        with patch.object(hook.requests, 'post', return_value=response) as post:
            with self.assertRaises(hook.HookError) as raised:
                api.call('DescribeRecord', {'Domain': hook.ZONE, 'RecordId': 123})
        self.assertEqual(str(raised.exception), 'AuthFailure.SignatureFailure')
        options = post.call_args.kwargs
        self.assertEqual(options['allow_redirects'], False)
        self.assertEqual(options['headers']['X-TC-Action'], 'DescribeRecord')
        self.assertIn('TC3-HMAC-SHA256', options['headers']['Authorization'])

    def test_both_authoritative_servers_must_show_exact_validation(self):
        good = Mock(returncode=0, stdout='"' + VALUE + '"\n')
        bad = Mock(returncode=0, stdout='"' + 'B' * 43 + '"\n')
        with patch.object(hook.shutil, 'which', return_value='/usr/bin/dig'), patch.object(hook.subprocess, 'run', side_effect=[good, bad]):
            self.assertFalse(hook.authoritative_visible(VALUE))
        with patch.object(hook.shutil, 'which', return_value='/usr/bin/dig'), patch.object(hook.subprocess, 'run', side_effect=[good, good]) as run:
            self.assertTrue(hook.authoritative_visible(VALUE))
            self.assertEqual(run.call_count, 2)
            self.assertTrue(all(hook.FQDN in call.args[0] for call in run.call_args_list))

    def test_propagation_is_bounded_and_waits_after_visibility(self):
        with patch.object(hook, 'authoritative_visible', return_value=False), patch.object(hook.time, 'monotonic', side_effect=[0, 121]), patch.object(hook.time, 'sleep') as sleep:
            with self.assertRaises(hook.HookError):
                hook.wait_for_propagation(VALUE)
            sleep.assert_not_called()
        with patch.object(hook, 'authoritative_visible', return_value=True), patch.object(hook.time, 'sleep') as sleep:
            hook.wait_for_propagation(VALUE)
            sleep.assert_called_once_with(60)


if __name__ == '__main__':
    unittest.main()
