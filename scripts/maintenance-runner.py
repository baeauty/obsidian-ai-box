"""Record real maintenance runs under a vault-wide exclusive lock. Does not do the review."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import json
import os
import uuid


def run(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['start', 'finish'])
    p.add_argument('--vault', required=True)
    p.add_argument('--kind', choices=['inbox', 'weekly', 'monthly'], required=True)
    p.add_argument('--trigger', choices=['manual', 'scheduled'], default='manual')
    p.add_argument('--token')
    p.add_argument('--result', choices=['success', 'failed'])
    p.add_argument('--evidence')
    p.add_argument('--error')
    a = p.parse_args(argv)
    vault = Path(a.vault).resolve(strict=True)
    folder = vault/'schema/维护'
    plan_path = folder/'AI Box维护.json'
    lock = folder/'.ai-box-maintenance.lock'
    if folder.is_symlink() or plan_path.is_symlink() or lock.is_symlink() or not folder.resolve().is_relative_to(vault):
        raise ValueError('Maintenance paths must be ordinary files inside the vault')

    def read():
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
        if plan.get('version') != 1 or a.kind not in plan.get('jobs', {}):
            raise ValueError('Invalid maintenance plan')
        return plan

    def save(plan):
        temp = folder/(uuid.uuid4().hex+'.tmp')
        try:
            with temp.open('x', encoding='utf-8', newline='\n') as f:
                json.dump(plan, f, ensure_ascii=False, indent=2)
                f.write('\n')
            os.replace(temp, plan_path)
        finally:
            if temp.exists():
                temp.unlink()

    now = datetime.now(timezone.utc).isoformat()
    if a.action == 'start':
        read()
        token = uuid.uuid4().hex
        with lock.open('x', encoding='utf-8') as f:
            json.dump({'kind': a.kind, 'token': token, 'trigger': a.trigger, 'startedAt': now}, f)
        try:
            plan = read()
            plan['jobs'][a.kind].update(lastAttempt=now, result='running', trigger=a.trigger)
            save(plan)
        except Exception:
            lock.unlink()
            raise
        return {'started': True, 'token': token, 'kind': a.kind}

    record = json.loads(lock.read_text(encoding='utf-8'))
    if not a.token or record.get('token') != a.token or record.get('kind') != a.kind:
        raise ValueError('Only the run owning the lock can finish it')
    if not a.result:
        raise ValueError('Finish requires --result')
    plan = read()
    job = plan['jobs'][a.kind]
    if a.result == 'success':
        if not a.evidence or Path(a.evidence).is_absolute():
            raise ValueError('Success requires vault-relative evidence')
        evidence = vault/a.evidence
        if evidence.is_symlink() or not evidence.resolve().is_relative_to(vault) or not evidence.is_file() or evidence.stat().st_size == 0:
            raise ValueError('Evidence must be a nonempty file inside the vault')
        job.update(result='success', lastSuccess=now, evidence=a.evidence, trigger=record['trigger'])
        job.pop('error', None)
    else:
        if not a.error:
            raise ValueError('Failure requires --error')
        job.update(result='failed', error=a.error, trigger=record['trigger'])
    save(plan)
    lock.unlink()
    return {'finished': True, 'kind': a.kind, 'result': a.result}


if __name__ == '__main__':
    print(json.dumps(run(), ensure_ascii=False))
