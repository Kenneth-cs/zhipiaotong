import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db';
import authRouter from './routes/auth';
import ocrRouter from './routes/ocr';
import invoicesRouter from './routes/invoices';
import foldersRouter from './routes/folders';
import quotaRouter from './routes/quota';

dotenv.config();

// 防止未捕获异常导致进程退出
process.on('uncaughtException', (err) => {
  console.error('❌ 未捕获异常（进程继续运行）:', err.message);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('❌ 未处理 Promise 拒绝（进程继续运行）:', reason?.message || reason);
});

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001');

// 中间件
const ALLOWED_ORIGINS = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    // 无 origin（服务间调用、curl）一律放行
    if (!origin) return callback(null, true);

    // localhost / 127.0.0.1 任意端口（开发环境）
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // CORS_ORIGIN 环境变量中列出的域名/IP
    if (ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + ':'))) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 路由
app.use('/api/auth', authRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/quota', quotaRouter);

// 健康检查
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// 全局错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('❌ 服务器错误:', err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '文件大小超过 10MB 限制' });
  }
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`🚀 小财犬后端服务已启动: http://localhost:${PORT}`);
  console.log(`📋 健康检查: http://localhost:${PORT}/api/health`);
});