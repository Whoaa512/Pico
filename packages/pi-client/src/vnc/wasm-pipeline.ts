import type { ASUtil } from '@assemblyscript/loader';
import type { RemoteDisplayPixelFormat } from './protocol';
import type { WasmDisplayPipeline } from './rfb-protocol';

const WASM_URL = '/wasm/remote-display-decoder.wasm';

interface DecoderExports extends ASUtil, Record<string, unknown> {
    memory: WebAssembly.Memory;
    initFramebuffer(width: number, height: number): void;
    getFramebufferPtr(): number;
    getFramebufferLen(): number;
    getFramebufferWidth(): number;
    getFramebufferHeight(): number;
    processRawRect(
        dataBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    processCopyRect(
        dstX: number, dstY: number, w: number, h: number,
        srcX: number, srcY: number,
    ): number;
    processRreRect(
        dataBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    processHextileRect(
        dataBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    processZrleTileData(
        decompressedBuffer: number, x: number, y: number, w: number, h: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    decodeRawRectToRgba(
        srcBuffer: number, width: number, height: number,
        bitsPerPixel: number, bigEndian: number, trueColor: number,
        rMax: number, gMax: number, bMax: number,
        rShift: number, gShift: number, bShift: number,
    ): number;
    __pin(ptr: number): number;
    __unpin(ptr: number): void;
    __collect(): void;
    __newArrayBuffer(buf: ArrayBuffer): number;
    __getArrayBuffer(ptr: number): ArrayBuffer;
}

const REQUIRED_EXPORTS = [
    'initFramebuffer', 'getFramebufferPtr', 'getFramebufferLen',
    'getFramebufferWidth', 'getFramebufferHeight',
    'processRawRect', 'processCopyRect', 'processRreRect',
    'processHextileRect', 'processZrleTileData',
    'decodeRawRectToRgba',
] as const;

let pipelinePromise: Promise<WasmDisplayPipeline | null> | null = null;

function normalizeInput(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
    if (bytes instanceof ArrayBuffer) return bytes;
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer as ArrayBuffer;
    }
    return bytes.slice().buffer as ArrayBuffer;
}

function callProcess(
    ex: DecoderExports,
    fnName: keyof DecoderExports,
    data: Uint8Array,
    x: number,
    y: number,
    w: number,
    h: number,
    pf: RemoteDisplayPixelFormat,
): number {
    const input = normalizeInput(data);
    const ptr = ex.__pin(ex.__newArrayBuffer(input));
    try {
        return (ex[fnName] as Function)(
            ptr, x, y, w, h,
            pf.bitsPerPixel,
            pf.bigEndian ? 1 : 0,
            pf.trueColor ? 1 : 0,
            pf.redMax, pf.greenMax, pf.blueMax,
            pf.redShift, pf.greenShift, pf.blueShift,
        );
    } finally {
        ex.__unpin(ptr);
        try { ex.__collect(); } catch {}
    }
}

export async function loadRemoteDisplayWasmDecoder(
    wasmUrl: string = WASM_URL,
): Promise<WasmDisplayPipeline | null> {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async (): Promise<WasmDisplayPipeline | null> => {
        try {
            const loader = await import('@assemblyscript/loader');
            const response = await fetch(wasmUrl, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const instantiated = typeof loader.instantiateStreaming === 'function'
                ? await loader.instantiateStreaming<DecoderExports>(response, {})
                : await loader.instantiate<DecoderExports>(await response.arrayBuffer(), {});
            const ex = instantiated.exports as DecoderExports;

            for (const fn of REQUIRED_EXPORTS) {
                if (typeof ex[fn] !== 'function') throw new Error(`${fn} export is missing.`);
            }

            return {
                initFramebuffer(width: number, height: number): void {
                    ex.initFramebuffer(width, height);
                },

                getFramebuffer(): Uint8ClampedArray {
                    const ptr = ex.getFramebufferPtr();
                    const len = ex.getFramebufferLen();
                    return new Uint8ClampedArray(
                        new Uint8Array(ex.memory.buffer, ptr, len).slice().buffer,
                    );
                },

                processRawRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processRawRect', data, x, y, w, h, pf);
                },

                processCopyRect(dstX: number, dstY: number, w: number, h: number, srcX: number, srcY: number): void {
                    ex.processCopyRect(dstX, dstY, w, h, srcX, srcY);
                },

                processRreRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processRreRect', data, x, y, w, h, pf);
                },

                processHextileRect(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processHextileRect', data, x, y, w, h, pf);
                },

                processZrleTileData(data: Uint8Array, x: number, y: number, w: number, h: number, pf: RemoteDisplayPixelFormat): void {
                    callProcess(ex, 'processZrleTileData', data, x, y, w, h, pf);
                },

                decodeRawRectToRgba(data: Uint8Array, width: number, height: number, pf: RemoteDisplayPixelFormat): Uint8ClampedArray {
                    const input = normalizeInput(data);
                    const inputPtr = ex.__pin(ex.__newArrayBuffer(input));
                    try {
                        const outputPtr = ex.__pin(ex.decodeRawRectToRgba(
                            inputPtr, width, height,
                            pf.bitsPerPixel,
                            pf.bigEndian ? 1 : 0,
                            pf.trueColor ? 1 : 0,
                            pf.redMax, pf.greenMax, pf.blueMax,
                            pf.redShift, pf.greenShift, pf.blueShift,
                        ));
                        try {
                            return new Uint8ClampedArray(ex.__getArrayBuffer(outputPtr));
                        } finally { ex.__unpin(outputPtr); }
                    } finally {
                        ex.__unpin(inputPtr);
                        try { ex.__collect?.(); } catch {}
                    }
                },
            };
        } catch (error) {
            console.warn('[remote-display] Failed to load WASM pipeline, using JS fallback.', error);
            return null;
        }
    })();
    return pipelinePromise;
}

export function resetWasmPipelineCache(): void {
    pipelinePromise = null;
}
