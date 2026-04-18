/**
 * 可配置并发数的任务队列
 * 免费版: maxConcurrent = 1 (逐张串行)
 * 正式版: maxConcurrent = 10 (10张并行)
 */

export interface QueueTask<T> {
  id: string;
  execute: () => Promise<T>;
}

export interface QueueCallbacks<T> {
  onTaskComplete: (id: string, result: T) => void;
  onTaskError: (id: string, error: Error) => void;
  onProgress: (completed: number, total: number) => void;
  onAllComplete: () => void;
}

export class TaskQueue<T> {
  private maxConcurrent: number;
  private queue: QueueTask<T>[] = [];
  private running = 0;
  private completed = 0;
  private total = 0;
  private cancelled = false;
  private callbacks: QueueCallbacks<T>;

  constructor(maxConcurrent: number, callbacks: QueueCallbacks<T>) {
    this.maxConcurrent = maxConcurrent;
    this.callbacks = callbacks;
  }

  /**
   * 添加任务到队列
   */
  addTask(task: QueueTask<T>) {
    this.queue.push(task);
    this.total++;
  }

  /**
   * 批量添加任务
   */
  addTasks(tasks: QueueTask<T>[]) {
    tasks.forEach((t) => this.addTask(t));
  }

  /**
   * 开始执行队列
   */
  start() {
    this.cancelled = false;
    this.completed = 0;
    this.processNext();
  }

  /**
   * 取消剩余任务（已在执行的会继续完成）
   */
  cancel() {
    this.cancelled = true;
    this.queue = [];
  }

  /**
   * 重试单个任务
   */
  retry(task: QueueTask<T>) {
    this.total++;
    this.queue.unshift(task);
    this.processNext();
  }

  private async processNext() {
    if (this.cancelled) return;
    if (this.running >= this.maxConcurrent) return;
    if (this.queue.length === 0) {
      if (this.running === 0) {
        this.callbacks.onAllComplete();
      }
      return;
    }

    const task = this.queue.shift()!;
    this.running++;

    try {
      const result = await task.execute();
      this.completed++;
      this.callbacks.onTaskComplete(task.id, result);
    } catch (err: any) {
      this.completed++;
      this.callbacks.onTaskError(task.id, err);
    } finally {
      this.running--;
      this.callbacks.onProgress(this.completed, this.total);
      this.processNext();
    }
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      total: this.total,
      completed: this.completed,
      running: this.running,
      pending: this.queue.length,
      cancelled: this.cancelled,
    };
  }
}