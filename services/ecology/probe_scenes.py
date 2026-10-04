"""受控反事实场景：单个个体 + 一块食物放在周围各相对位置。供模型诊断共用；不执行动作，不产生轨迹。"""
import math
from bridge import Bridge

MOVES = {'north': (0, -1), 'south': (0, 1), 'east': (1, 0), 'west': (-1, 0)}

def sensible(vx, vy, legal):
    """朝食物的合法动作：移动后距离变小；脚下有食物则只有 eat。"""
    if math.hypot(vx, vy) < .5: return {'eat'} & set(legal)
    base = math.hypot(vx, vy)
    return {a for a, (dx, dy) in MOVES.items() if a in legal and math.hypot(vx - dx, vy - dy) < base - 1e-9}

def build_scenes(energies=(8.0, 30.0), amounts=(2.0, 6.0, 12.0)):
    scenes = []
    with Bridge() as b:
        for energy in energies:
            for seed in range(41, 80):
                s = b.call('reset', config={'runId': 'laya-probe', 'seed': seed, 'width': 11, 'height': 11, 'initialAgents': 1, 'initialEnergy': energy, 'initialFood': 0, 'reproduction': False})['snapshot']
                a = s['agents'][0]
                if 3 <= a['x'] < 8 and 3 <= a['y'] < 8: break
            else: raise RuntimeError('probe_fixture_position')
            cx, cy = int(a['x']), int(a['y'])
            for amount in amounts:
                b.call('restore', snapshot=s); scenes.append({'kind': 'no-food', 'energy': energy, 'amount': 0, 'cell': None, 'request': b.call('observe')[0]})
                for dy in range(-3, 4):
                    for dx in range(-3, 4):
                        if abs(dx) + abs(dy) > 3: continue
                        b.call('restore', snapshot=s); b.call('intervene', command={'kind': 'nutrient', 'x': cx + dx, 'y': cy + dy, 'amount': amount})
                        req = b.call('observe')[0]; o = req['observation']
                        cell = next((c for c in o['local'] if abs(c['dx'] - (cx + dx + .5 - a['x'])) < 1e-6 and abs(c['dy'] - (cy + dy + .5 - a['y'])) < 1e-6), None)
                        if cell is None or cell['food'] < .01: continue
                        scenes.append({'kind': 'food', 'energy': energy, 'amount': amount, 'cell': [cell['dx'], cell['dy']], 'request': req})
    return scenes
