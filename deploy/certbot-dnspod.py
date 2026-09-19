#!/usr/bin/env python3
"""Certbot DNS-01 hooks restricted to mandarin.aiducation.asia.

No credentials belong in this file. Invoke with `auth` or `cleanup` as root.
Only the TXT record created by a successful auth run may be removed by cleanup.
"""
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import time

import requests

DOMAIN = 'mandarin.aiducation.asia'
ZONE = 'aiducation.asia'
LABEL = '_acme-challenge.mandarin'
FQDN = LABEL + '.' + ZONE
ENV_FILE = Path('/home/ubuntu/maanshan-shared/app.env')
STATE_DIR = Path('/var/lib/maanshan-acme')
AUTHORITATIVE = ('dew.dnspod.net', 'ring.dnspod.net')
API_HOST = 'dnspod.tencentcloudapi.com'
VALIDATION_RE = re.compile(r'[A-Za-z0-9_-]{43}')
RUN_RE = re.compile(r'[0-9a-f]{32}')


class HookError(Exception):
    def __init__(self, code):
        self.code = code if re.fullmatch(r'[A-Za-z0-9_.-]{1,96}', str(code)) else 'HookError'
        super().__init__(self.code)


def challenge(environ=os.environ):
    domain = environ.get('CERTBOT_DOMAIN', '')
    validation = environ.get('CERTBOT_VALIDATION', '')
    if domain != DOMAIN or not VALIDATION_RE.fullmatch(validation):
        raise HookError('InvalidChallengeScope')
    return validation


def credentials():
    info = ENV_FILE.lstat()
    if not stat.S_ISREG(info.st_mode) or (os.name != 'nt' and stat.S_IMODE(info.st_mode) & 0o077):
        raise HookError('UnsafeCredentialFile')
    found = {}
    for line in ENV_FILE.read_text(encoding='utf-8-sig').splitlines():
        match = re.match(r'^\s*(?:export\s+)?(TENCENT_SECRET_ID|TENCENT_SECRET_KEY)\s*=\s*(.*)$', line)
        if not match:
            continue
        values = shlex.split(match[2], comments=True, posix=True)
        if len(values) != 1 or not values[0] or any(char.isspace() for char in values[0]):
            raise HookError('InvalidCredentialFile')
        found[match[1]] = values[0]
    if set(found) != {'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'}:
        raise HookError('MissingCredentials')
    return found['TENCENT_SECRET_ID'], found['TENCENT_SECRET_KEY']


class DNSPod:
    def __init__(self, secret_id, secret_key):
        self.secret_id = secret_id
        self.secret_key = secret_key

    def call(self, action, payload):
        # A programming error cannot turn this ownership hook into a broad DNS tool.
        if action == 'CreateRecord':
            expected = {'Domain', 'SubDomain', 'RecordType', 'RecordLine', 'Value', 'TTL'}
            if set(payload) != expected or payload.get('Domain') != ZONE or payload.get('SubDomain') != LABEL or payload.get('RecordType') != 'TXT' or payload.get('RecordLine') != '默认' or payload.get('TTL') != 600 or not VALIDATION_RE.fullmatch(str(payload.get('Value', ''))):
                raise HookError('InvalidAPIScope')
        elif action in ('DescribeRecord', 'DeleteRecord'):
            if set(payload) != {'Domain', 'RecordId'} or payload.get('Domain') != ZONE or type(payload.get('RecordId')) is not int or payload['RecordId'] <= 0:
                raise HookError('InvalidAPIScope')
        else:
            raise HookError('InvalidAPIAction')
        timestamp = int(time.time())
        date = datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime('%Y-%m-%d')
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        digest = lambda value: hashlib.sha256(value).hexdigest()
        headers = 'content-type:application/json; charset=utf-8\nhost:' + API_HOST + '\n'
        canonical = 'POST\n/\n\n' + headers + '\ncontent-type;host\n' + digest(body)
        scope = date + '/dnspod/tc3_request'
        message = 'TC3-HMAC-SHA256\n' + str(timestamp) + '\n' + scope + '\n' + digest(canonical.encode())
        sign = lambda key, value: hmac.new(key, value.encode(), hashlib.sha256).digest()
        signing_key = sign(sign(sign(('TC3' + self.secret_key).encode(), date), 'dnspod'), 'tc3_request')
        signature = hmac.new(signing_key, message.encode(), hashlib.sha256).hexdigest()
        authorization = 'TC3-HMAC-SHA256 Credential=' + self.secret_id + '/' + scope + ', SignedHeaders=content-type;host, Signature=' + signature
        try:
            response = requests.post('https://' + API_HOST, data=body, headers={
                'Content-Type': 'application/json; charset=utf-8', 'Host': API_HOST,
                'Authorization': authorization, 'X-TC-Action': action,
                'X-TC-Version': '2021-03-23', 'X-TC-Timestamp': str(timestamp)
            }, timeout=(8, 20), allow_redirects=False)
            if response.status_code != 200:
                raise HookError('APIHTTP_' + str(response.status_code))
            result = response.json()['Response']
            if 'Error' in result:
                raise HookError(result['Error'].get('Code', 'APIError'))
            return result
        except requests.RequestException:
            raise HookError('APINetworkError') from None
        except (ValueError, KeyError, TypeError):
            raise HookError('InvalidAPIResponse') from None


def ensure_state_dir():
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = STATE_DIR.lstat()
    if not stat.S_ISDIR(info.st_mode) or (os.name != 'nt' and (info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700)):
        raise HookError('UnsafeStateDirectory')


def validation_hash(validation):
    return hashlib.sha256(validation.encode()).hexdigest()


def create_state(record_id, validation):
    ensure_state_dir()
    run = secrets.token_hex(16)
    filename = STATE_DIR / (run + '.json')
    record = {'domain': DOMAIN, 'record_id': record_id, 'validation_hash': validation_hash(validation), 'created_at': int(time.time())}
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        json.dump(record, output, separators=(',', ':'))
        output.flush()
        os.fsync(output.fileno())
    return run


def remove_matching_record(api, record_id, validation):
    try:
        record = api.call('DescribeRecord', {'Domain': ZONE, 'RecordId': record_id}).get('RecordInfo', {})
    except HookError as error:
        if error.code in ('InvalidParameter.RecordId', 'ResourceNotFound.NoDataOfRecord', 'ResourceNotFound.RecordNotExists'):
            return
        raise
    # DescribeRecord uses Id/SubDomain/RecordType (unlike DescribeRecordList).
    if record.get('SubDomain') != LABEL or record.get('RecordType') != 'TXT' or record.get('Value') != validation or record.get('Id') != record_id:
        raise HookError('CleanupRecordMismatch')
    api.call('DeleteRecord', {'Domain': ZONE, 'RecordId': record_id})


def cleanup(api, validation, run):
    if not RUN_RE.fullmatch(run):
        raise HookError('InvalidCleanupState')
    ensure_state_dir()
    filename = STATE_DIR / (run + '.json')
    try:
        info = filename.lstat()
        if not stat.S_ISREG(info.st_mode) or (os.name != 'nt' and (info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077)):
            raise HookError('UnsafeCleanupState')
        record = json.loads(filename.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return # Certbot may run cleanup again after an interrupted invocation.
    if record.get('domain') != DOMAIN or record.get('validation_hash') != validation_hash(validation) or type(record.get('record_id')) is not int or record['record_id'] <= 0:
        raise HookError('CleanupStateMismatch')
    remove_matching_record(api, record['record_id'], validation)
    filename.unlink()


def authoritative_visible(validation):
    dig = shutil.which('dig')
    if not dig:
        # An official HTTPS resolver is the dependency-free fallback. Its cache
        # can delay visibility; failure leaves renewal failed rather than guessed.
        try:
            response = requests.get('https://dns.alidns.com/resolve', params={'name': FQDN, 'type': 'TXT'}, timeout=10, allow_redirects=False)
            if response.status_code != 200:
                return False
            answers = response.json().get('Answer', [])
            return any(answer.get('type') == 16 and answer.get('name', '').rstrip('.').lower() == FQDN and answer.get('data', '').strip('"') == validation for answer in answers)
        except (requests.RequestException, ValueError, TypeError):
            return False
    for nameserver in AUTHORITATIVE:
        try:
            result = subprocess.run([dig, '@' + nameserver, FQDN, 'TXT', '+short', '+norecurse', '+time=3', '+tries=1'], capture_output=True, text=True, timeout=5, check=False)
            if result.returncode or ('"' + validation + '"') not in result.stdout.splitlines():
                return False
        except (OSError, subprocess.TimeoutExpired):
            return False
    return True


def wait_for_propagation(validation):
    deadline = time.monotonic() + 120
    while True:
        if authoritative_visible(validation):
            # Give validating resolvers time to refresh after both authoritative
            # servers agree. This is a settle interval, not a promise about TTL.
            time.sleep(60)
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HookError('DNSPropagationTimeout')
        time.sleep(min(5, remaining))


def authenticate(api, validation):
    ensure_state_dir()
    result = api.call('CreateRecord', {'Domain': ZONE, 'SubDomain': LABEL, 'RecordType': 'TXT', 'RecordLine': '默认', 'Value': validation, 'TTL': 600})
    record_id = result.get('RecordId')
    if type(record_id) is not int or record_id <= 0:
        raise HookError('InvalidCreatedRecordId')
    run = None
    try:
        run = create_state(record_id, validation)
        print(run, flush=True) # The only stdout: passed back as CERTBOT_AUTH_OUTPUT.
        wait_for_propagation(validation)
    except Exception:
        try:
            if run:
                cleanup(api, validation, run)
            else:
                remove_matching_record(api, record_id, validation)
        except Exception:
            print('DNSPod hook error: AuthRollbackFailed', file=sys.stderr)
        raise


def main():
    try:
        if os.name != 'posix' or os.geteuid() != 0:
            raise HookError('RootRequired')
        if len(sys.argv) != 2 or sys.argv[1] not in ('auth', 'cleanup'):
            raise HookError('InvalidAction')
        validation = challenge()
        api = DNSPod(*credentials())
        if sys.argv[1] == 'auth':
            authenticate(api, validation)
        else:
            cleanup(api, validation, os.environ.get('CERTBOT_AUTH_OUTPUT', '').strip())
        return 0
    except HookError as error:
        print('DNSPod hook error: ' + error.code, file=sys.stderr)
    except Exception:
        # Exception messages can include HTTP headers or dotenv contents.
        print('DNSPod hook error: LocalOperationFailed', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
