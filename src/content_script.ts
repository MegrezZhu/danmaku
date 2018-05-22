import axios from 'axios';
import { promisify } from 'bluebird';
import echarts = require('echarts');
import * as $ from 'jquery';
import ResizeObserver from 'resize-observer-polyfill';
import { combineLatest, from, Observable, Observer } from 'rxjs';
import { concatMap, distinctUntilChanged, filter, map, take } from 'rxjs/operators';
import { convertableToString, parseString } from 'xml2js';

function observeElement (faSelector: string, selector: string): Observable<HTMLElement> {
    return Observable.create((observer: Observer<HTMLElement>) => {
        const parent = $(faSelector);
        const ele = parent.find(selector);
        if (ele.length !== 0) {
            observer.next(ele[0]);
            return observer.complete();
        }
        let toDisconnect: MutationObserver | null = null;
        const obs = toDisconnect = new MutationObserver((mutations: MutationRecord[]) => {
            const ele = parent.find(selector);
            if (ele.length !== 0) {
                observer.next(ele[0]);
                observer.complete();
                return toDisconnect!.disconnect();
            }
        });
        obs.observe(parent[0], {
            subtree: true,
            childList: true
        });

    });
}

function observeContent (node: HTMLElement): Observable<string> {
    return Observable.create((observer: Observer<string>) => {
        observer.next($(node).text());
        const mutationObs = new MutationObserver((mutations: MutationRecord[]) => {
            for (const rec of mutations) {
                if (rec.type === 'childList') {
                    observer.next($(node).text());
                }
            }
        });
        mutationObs.observe(
            node,
            {
                characterData: false,
                attributes: false,
                childList: true,
                subtree: false
            }
        );
    });
}

function observeAny (node: HTMLElement): Observable<null> {
    return Observable.create((observer: Observer<null>) => {
        observer.next(null);
        const mutationObs = new MutationObserver((mutations: MutationRecord[]) => {
            observer.next(null);
        });
        mutationObs.observe(node, { childList: true });
    });
}

function observeSize (node: HTMLElement): Observable<null> {
    return Observable.create((observer: Observer<null>) => {
        observer.next(null);
        const resizeObs = new ResizeObserver(() => observer.next(null));
        resizeObs.observe(node);
    });
}

async function initialize (): Promise<void> {
    const obContext = observeElement('body', '#bofqi') // wait for element created
        .pipe(
            concatMap(observeAny),
            map(() => location.href), // detect url changes
            distinctUntilChanged(),
            map(url => {
                const match = url.match(/\Wp=(\d+)/); // parse ?p=x query in url
                return match ? Number(match[1]) : 1;
            }),
            distinctUntilChanged()
        )
        .pipe(concatMap(createContext));
    obContext.subscribe(render);
}

function createContext (page: number): Observable<IContext> {
    const obLength = observeElement('body', '.bilibili-player-video-time-total')
        .pipe(
            concatMap(observeContent),
            map(str => str.split(':').reduce((acc, x) => acc * 60 + Number(x), 0)), // parse video length
            filter(vLength => vLength !== 0),
            take(1)
        );

    const obCid = from(getCid())
        .pipe(
            map(cids => cids[page - 1]),
            concatMap(cid => from(getDanmaku(cid)))
        );

    return combineLatest(obLength, obCid)
        .pipe(
            map(([vLen, danmaku]) => ({
                danmaku,
                length: vLen
            })),
            take(1)
        );
}

async function getCid (): Promise<number[]> {
    const { data: pageSource } = await axios.get(location.href);
    const re = /"cid":(\d+)/g;
    const res: number[] = [];
    while (true) {
        const match = re.exec(pageSource);
        if (match) {
            res.push(Number(match[1]));
        } else {
            break;
        }
    }
    return res;
}

function render (context: IContext) {
    $('#megrez-danmaku').remove();
    $('<div id="megrez-danmaku"></div>').prependTo('.bpui-slider-tracker-wrp');

    const chart = echarts.init($('#megrez-danmaku').get(0) as HTMLCanvasElement);
    const hist = divideBins(context.danmaku.map(d => d.offset), context.length, 50);
    chart.setOption({
        xAxis: { show: false, data: hist.keys() },
        yAxis: { show: false },
        series: [{
            type: 'line',
            data: hist.map(x => x ** 0.8),
            smooth: true,
            symbol: 'none',
            areaStyle: {
                color: '#fff',
                opacity: .3
            },
            lineStyle: {
                show: false,
                color: '#fff',
                opacity: .3
            }
        }],
        grid: {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0
        }
    });

    observeSize($('.bpui-slider-tracker-wrp').get(0))
        .subscribe(() => {
            chart.resize();
        });
    console.log('danmaku: render finished.');
}

interface IContext {
    danmaku: IDanmaku[];
    length: number;
}

interface IDanmaku {
    timestamp: Date;
    offset: number;
    content: string;
}

interface IRawDanmaku {
    _: string;
    $: {
        p: string;
    };
}

const parseXML = promisify(parseString as ((xml: convertableToString, cb: (err: any, result?: any) => void) => void));

async function getDanmaku (cid: number): Promise<IDanmaku[]> {
    const { data } = await axios.get(`https://comment.bilibili.com/${cid}.xml`);
    const { i: { d } }: { i: { d: IRawDanmaku[] } } = await parseXML(data);
    return d.map(parseRawDanmaku);
}

function parseRawDanmaku (raw: IRawDanmaku): IDanmaku {
    /*
        danmaku format ref: http://ju.outofmemory.cn/entry/146571
    */
    const res = {} as IDanmaku;

    res.content = raw._;
    const attrs = raw.$.p.split(',');
    res.offset = Number(attrs[0]);
    res.timestamp = new Date(Number(attrs[4]) * 1000);

    return res;
}

function divideBins (data: number[], totalLength: number, bins: number): number[] {
    const width = totalLength / bins;
    const res = Array(bins).fill(0);
    for (const x of data) {
        const into = Math.floor(Math.min(x / width, bins - 1));
        res[into]++;
    }
    return res;
}

initialize();
