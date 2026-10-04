"""只验证协议和桥；不下载模型、不访问网络。"""
import copy
import json
import sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.ecology.bridge import Bridge
from services.ecology.provider import encode


def test_local_only_encoding_and_mapping():
    with Bridge() as bridge:
        requests = bridge.call('reset', config={'seed': 311})['requests']
        request = requests[0]
        state, questions, labels = encode(request)
        for secret in ['runId', 'snapshotId', 'parentId', 'phaseTicks', 'life-0']:
            assert secret not in state
        reverse = copy.deepcopy(request); reverse['candidates'].reverse()
        assert list(encode(reverse)[2].values()) == list(labels.values())[::-1]
        assert 'Remembered food' not in encode(request, memory=False)[0]
        for mutate in [lambda r: r['observation'].update(global_food=300),
                       lambda r: r['observation'].update(energy=float('nan')),
                       lambda r: r['observation']['neighbors'].append({'dx': 0, 'dy': 0, 'shape': 0, 'energy': 40}),
                       lambda r: r['observation']['local'].append({'dx': 100, 'dy': 0, 'food': 1, 'blocked': False}),
                       lambda r: r['candidates'].clear()]:
            changed = copy.deepcopy(request); mutate(changed)
            with pytest.raises(ValueError): encode(changed)


def test_real_ts_bridge_and_independent_restore():
    with Bridge() as bridge:
        initial = bridge.call('reset', config={'seed': 41, 'initialAgents': 3})
        bridge.call('reset', id='branch', config={'seed': 42})
        bridge.call('restore', id='branch', snapshot=initial['snapshot'])
        for _ in range(3):
            p = bridge.call('controller', mode='rule')
            result = bridge.call('step', proposals=p)
            assert result['accepted']
        assert bridge.call('snapshot', id='branch') == initial['snapshot']
        requests = bridge.call('observe', id='branch')
        assert len(requests) == 3
        assert all(encode(r)[0] for r in requests)


def test_north_description_is_not_mapped_to_another_direction():
    with Bridge() as bridge:
        request = bridge.call('reset', config={'initialAgents': 1, 'seed': 19})['requests'][0]
        request['observation']['local'] = [{'dx': 0, 'dy': -1, 'food': 3, 'blocked': False}, {'dx': 0, 'dy': 0, 'food': 0, 'blocked': False}]
        request['observation']['memory'] = []; request['observation']['neighbors'] = []
        text, _, labels = encode(request)
        assert '1.0 units north' in text
        assert set(labels.values()) == {c['id'] for c in request['candidates']}
