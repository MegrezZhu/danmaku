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
        setImmediate(() => {
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

function observeSize (node: HTMLElement): Observable<null> {
    return Observable.create((observer: Observer<null>) => {
        observer.next(null);
        const resizeObs = new ResizeObserver(() => observer.next(null));
        resizeObs.observe(node);
    });
}

function observeLocation (): Observable<string> {
    const observable = Observable.create((observer: Observer<string>) => {
        observer.next(location.href);
        $(window).on('hashchange', () => observer.next(location.href));
        $(window).on('popstate', () => observer.next(location.href));

        const port = chrome.runtime.connect({ name: 'danmaku' });
        port.onMessage.addListener((message: any) => {
            console.log(message);
            if (message.type === 'HISTORY_STATE_UPDATED') {
                observer.next(location.href);
            }
        });
    });
    return observable.pipe(
        // tap(str => console.log(str)),
        distinctUntilChanged()
    );
}

async function initialize (): Promise<void> {
    console.log('danmaku: loaded');
    observeLocation()
        .pipe(
            concatMap(() => observeElement('body', '#bofqi')), // wait for element created
            map(() => {
                let match = location.href.match(/\Wp=(\d+)/); // ?p=x
                if (match) {
                    return Number(match[1]);
                }
                match = location.href.match(/\Wpage=(\d+)/); // ?page=x
                return match ? Number(match[1]) : 1;
            })
        )
        .pipe(
            concatMap(createContext)
            // tap(ctx => console.log(ctx))
        )
        .subscribe(render);
}

function createContext (page: number): Observable<IContext> {
    const obLength = observeElement('body', '.bilibili-player-video-time-total')
        .pipe(
            concatMap(observeContent),
            map(str => str.split(':').reduce((acc, x) => acc * 60 + Number(x), 0)), // parse video length
            filter(vLength => vLength !== 0),
            // tap(len => console.log(`length ${len}`)),
            take(1)
        );

    const obCid = from(getCid(page))
        .pipe(
            // tap(cid => console.log(`cid ${cid}`)),
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

async function getCid (page: number): Promise<number> {
    const { data: pageSource } = await axios.get(location.href);
    if (location.href.match(/bangumi\/play/)) {
        // bangumi
        const initialState = parseInitialState(pageSource);
        return initialState.epInfo.cid;
    } else {
        // other videos
        const res: number[] = getAllCaptured(pageSource, /"cid":(\d+)/g).map(Number);
        if (res.length) {
            return res[page - 1];
        } else {
            // another format
            return Number(getAllCaptured(pageSource, /cid='(\d+)'/g)[page - 1]);
        }
    }
}

function parseInitialState (page: string): {[k: string]: any} {
    const match = page.match(/window\.__INITIAL_STATE__=(.+);\(function\(\)/);
    if (match) {
        return JSON.parse(match[1]);
    } else {
        throw new Error('failed to parse INITIAL_STATE');
    }
}

function getAllCaptured (source: string, re: RegExp): string[] {
    const res: string[] = [];
    while (true) {
        const match = re.exec(source);
        if (match) {
            res.push(match[1]);
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
    return [0, ...res, 0];
}

initialize();
