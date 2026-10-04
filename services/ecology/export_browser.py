"""把完成的真实无界面轨迹转换为浏览器动作回放；不推理、不训练，不捏造未记录耗时。"""
import argparse
import hashlib
import json
from pathlib import Path

def convert(directory,output):
    if output.exists():raise ValueError('output_exists')
    report=json.loads((directory/'report.json').read_text());initial=json.loads((directory/'initial.json').read_text())
    mode={'memory':'laya-memory'}.get(report['mode'],report['mode']);entries=[];final=initial
    for line in (directory/'rounds.jsonl').open():
        row=json.loads(line);result=row['result']
        if not result['accepted']:raise ValueError('unaccepted_round')
        entry={'kind':'round','mode':mode,'requests':result['requests'],'proposals':result['proposals'],'records':row['modelRecords'],
            'outcomes':result['outcomes'],'events':result['events'],'beforeHash':result['beforeHash'],'afterHash':result['afterHash'],'wallMilliseconds':None}
        if row['prepared'] is not None:entry['learning']={'prepared':row['prepared'],'receipt':row['receipt']}
        entries.append(entry);final=result['snapshot']
    if len(entries)!=report['rounds'] or final['tick']!=report['tick']:raise ValueError('incomplete_trajectory')
    record={'format':'ecology-recording-v1','simulator':initial['version'],'canResumeLearning':False,'initial':initial,'entries':entries,'attempts':[],
        'final':final,'mode':mode,'complete':True,'stopReason':None,
        'origin':{'type':'recorded-headless-experiment','source':str(directory),'roundsSha256':hashlib.sha256((directory/'rounds.jsonl').read_bytes()).hexdigest(),
                  'note':'真实历史动作回放。独立尝试时间线及整轮墙钟耗时未记录，保留空值；原始模型耗时保留。最终时限后的bootstrap不包含在动作回放，完整学习状态另用检查点恢复。'}}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(record,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    return {'rounds':len(entries),'bytes':output.stat().st_size,'newModelCalls':0}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('output');args=parser.parse_args()
    print(json.dumps(convert(Path(args.directory),Path(args.output))))
