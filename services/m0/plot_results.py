"""画出全部预定轨迹；死亡后不补值，不以幸存者均值替代原始曲线。"""
import argparse,collections,json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from bridge import ROOT

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();source=ROOT/args.run
    report=json.loads((source/'report.json').read_text());assert report['status']=='completed'
    cfg=json.loads((source/'config.json').read_text());out=ROOT/'docs/m0'
    names={'rule':'Rule','fixed-current':'Fixed Laya - current','fixed-memory':'Fixed Laya - memory','B':'Laya + individual PPO','no-laya':'Individual PPO - no Laya','frozen-B':'Initial frozen PPO + Laya'}
    colors=['#216b67','#bc7446','#7e63a6']
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
    for stage in ['online','heldout']:
        modes=list(dict.fromkeys(r['mode'] for r in report[stage]));rows=collections.defaultdict(list)
        for line in (source/f'{stage}-decisions.jsonl').read_text().splitlines():
            row=json.loads(line)
            if 'transition' in row:rows[row['id']].append(row)
        fig,axes=plt.subplots(2 if stage=='online' else 1,3,figsize=(13,7 if stage=='online' else 4),sharex=True,sharey=True,squeeze=False)
        seeds=cfg['seed_training' if stage=='online' else 'seed_heldout']
        for ax,mode in zip(axes.flat,modes):
            for i,seed in enumerate(seeds):
                trajectory=rows[f'{stage}-{seed}-{mode}']
                ticks=[0]+[r['transition']['tick'] for r in trajectory]
                energy=[cfg['world']['initialEnergy']]+[r['transition']['snapshot']['energy'] for r in trajectory]
                ax.plot(ticks,energy,color=colors[i],lw=1.3,label=f'Seed {seed}')
                if trajectory[-1]['transition']['terminated']:ax.plot(ticks[-1],energy[-1],'x',color=colors[i],ms=8,mew=2)
            for phase in range(3):
                start=phase*cfg['world']['phaseSteps'];end=(phase+1)*cfg['world']['phaseSteps']
                ax.axvspan(start,end,color='#e9efe9' if phase!=1 else '#f4e8d8',alpha=.5,zorder=-1)
                ax.text((start+end)/2,41,['A','B','A'][phase],ha='center',color='#888888',fontsize=9)
            ax.set_title(names[mode],loc='left',fontsize=11);ax.set_xlim(0,cfg['world']['horizon']);ax.set_ylim(-2,44)
            ax.set_xlabel('Executed simulation steps');ax.set_ylabel('Energy');ax.grid(axis='y',alpha=.15)
        axes.flat[0].legend(loc='lower right',fontsize=8,frameon=False)
        title='Online learning and controls' if stage=='online' else 'Heldout evaluation - all policies frozen'
        fig.suptitle(title,fontsize=16,x=.06,ha='left')
        fig.text(.06,.015,'All prescribed seeds. X marks death; no values are filled after death. Background shows the hidden resource schedule.',fontsize=9,color='#666666')
        fig.tight_layout(rect=(0,.05,1,.95));fig.savefig(out/f'{stage}-energy.png',dpi=150,facecolor='white');plt.close(fig)
    print('Wrote online and heldout full-trajectory figures.')
