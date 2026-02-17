type Processor = (event: any) => Promise<void>;

export class SymbolEventQueue {
    private queue: any[] = [];
    private head = 0;
    private processing = false;
    private symbol: string;
    private processor: Processor;
    private readonly maxQueueSize: number;
    private dropped = 0;

    constructor(symbol: string, processor: Processor, maxQueueSize: number = Number(process.env.SYMBOL_EVENT_QUEUE_MAX || 5000)) {
        this.symbol = symbol;
        this.processor = processor;
        this.maxQueueSize = Number.isFinite(maxQueueSize) && maxQueueSize > 100 ? Math.trunc(maxQueueSize) : 5000;
    }

    public enqueue(event: any) {
        if (this.getQueueLength() >= this.maxQueueSize) {
            // Drop oldest message when overloaded to prevent event-loop starvation.
            this.head += 1;
            this.dropped += 1;
        }
        this.queue.push(event);
        this.compactIfNeeded();
        this.processNext();
    }

    private async processNext() {
        if (this.processing || this.getQueueLength() === 0) return;

        this.processing = true;
        const event = this.queue[this.head];
        this.head += 1;

        try {
            await this.processor(event);
        } catch (e) {
            console.error(`[Queue] Error processing ${this.symbol}:`, e);
        } finally {
            this.processing = false;
            this.compactIfNeeded();
            // Immediate recurse for next in queue
            setImmediate(() => this.processNext());
        }
    }

    public getQueueLength() {
        return Math.max(0, this.queue.length - this.head);
    }

    public getDroppedCount() {
        return this.dropped;
    }

    private compactIfNeeded() {
        if (this.head > 0 && (this.head >= 2048 || this.head > (this.queue.length >> 1))) {
            this.queue = this.queue.slice(this.head);
            this.head = 0;
        }
    }
}
